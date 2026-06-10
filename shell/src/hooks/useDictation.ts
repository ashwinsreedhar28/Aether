import { useState, useEffect, useRef, useCallback } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

export interface DictationState {
  isRecording: boolean;
  isTranscribing: boolean;
  error: string | null;
  lastTranscription: string | null;
}

interface UseDictationReturn {
  state: DictationState;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
  isEnabled: boolean;
}

export function useDictation(): UseDictationReturn {
  const { settings } = useSettingsStore();
  const dictationSettings = settings.input.dictation;

  const [state, setState] = useState<DictationState>({
    isRecording: false,
    isTranscribing: false,
    error: null,
    lastTranscription: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Sync API key with main process when settings change
  useEffect(() => {
    if (dictationSettings.openAiApiKey) {
      window.electron.whisper.setApiKey(dictationSettings.openAiApiKey);
    }
  }, [dictationSettings.openAiApiKey]);

  const isEnabled = dictationSettings.enabled && !!dictationSettings.openAiApiKey;

  const startRecording = useCallback(async () => {
    if (!isEnabled) {
      setState(s => ({ ...s, error: 'Dictation not configured' }));
      return;
    }

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      streamRef.current = stream;
      audioChunksRef.current = [];

      // Create MediaRecorder with webm format (supported by Whisper)
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100); // Collect data every 100ms

      setState(s => ({
        ...s,
        isRecording: true,
        error: null,
      }));
    } catch (err) {
      console.error('Failed to start recording:', err);
      setState(s => ({
        ...s,
        error: err instanceof Error ? err.message : 'Failed to access microphone',
      }));
    }
  }, [isEnabled]);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    const mediaRecorder = mediaRecorderRef.current;
    const stream = streamRef.current;

    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      return null;
    }

    return new Promise((resolve) => {
      mediaRecorder.onstop = async () => {
        // Stop all tracks
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }

        // Create blob from chunks
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];

        // Don't transcribe if too short (less than 0.5 seconds of data)
        if (audioBlob.size < 1000) {
          setState(s => ({
            ...s,
            isRecording: false,
            error: 'Recording too short',
          }));
          resolve(null);
          return;
        }

        setState(s => ({
          ...s,
          isRecording: false,
          isTranscribing: true,
        }));

        try {
          // Convert blob to ArrayBuffer
          const arrayBuffer = await audioBlob.arrayBuffer();

          // Send to Whisper API
          const result = await window.electron.whisper.transcribe(
            arrayBuffer,
            dictationSettings.language
          );

          if (result.success && result.text) {
            setState(s => ({
              ...s,
              isTranscribing: false,
              lastTranscription: result.text || null,
              error: null,
            }));
            resolve(result.text);
          } else {
            setState(s => ({
              ...s,
              isTranscribing: false,
              error: result.error || 'Transcription failed',
            }));
            resolve(null);
          }
        } catch (err) {
          console.error('Transcription error:', err);
          setState(s => ({
            ...s,
            isTranscribing: false,
            error: err instanceof Error ? err.message : 'Transcription failed',
          }));
          resolve(null);
        }
      };

      mediaRecorder.stop();
    });
  }, [dictationSettings.language]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return {
    state,
    startRecording,
    stopRecording,
    isEnabled,
  };
}
