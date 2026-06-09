/**
 * Whisper API handlers for voice dictation
 */

import { ipcMain, BrowserWindow } from 'electron';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// Store the API key in memory (loaded from renderer's settings)
let openAiApiKey: string | null = null;

interface TranscriptionResult {
  success: boolean;
  text?: string;
  error?: string;
}

async function transcribeAudio(
  audioBuffer: Buffer,
  language: string | null
): Promise<TranscriptionResult> {
  if (!openAiApiKey) {
    return { success: false, error: 'OpenAI API key not configured' };
  }

  // Write buffer to temp file
  const tempPath = join(tmpdir(), `whisper-${randomUUID()}.webm`);

  try {
    await writeFile(tempPath, audioBuffer);

    // Read the file back as a blob-like structure for FormData
    const fileData = await readFile(tempPath);

    // Use native FormData (available in Node 18+)
    const formData = new FormData();

    // Create a Blob from the file data
    const blob = new Blob([fileData], { type: 'audio/webm' });
    formData.append('file', blob, 'audio.webm');
    formData.append('model', 'whisper-1');

    if (language) {
      formData.append('language', language);
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAiApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: { message: response.statusText },
      })) as { error?: { message?: string } };
      return {
        success: false,
        error: errorData.error?.message || `API error: ${response.status}`,
      };
    }

    const result = (await response.json()) as { text: string };
    return { success: true, text: result.text };
  } catch (err) {
    console.error('Whisper transcription error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  } finally {
    // Clean up temp file
    await unlink(tempPath).catch(() => {});
  }
}

export function registerWhisperHandlers(_getMainWindow: () => BrowserWindow | null) {
  // Set API key from renderer
  ipcMain.handle('whisper:setApiKey', (_, apiKey: string | null) => {
    openAiApiKey = apiKey;
    return { success: true };
  });

  // Transcribe audio
  ipcMain.handle(
    'whisper:transcribe',
    async (_, audioData: ArrayBuffer, language: string | null) => {
      const buffer = Buffer.from(audioData);
      return await transcribeAudio(buffer, language);
    }
  );

  // Get current API key status (not the key itself)
  ipcMain.handle('whisper:hasApiKey', () => {
    return { hasKey: !!openAiApiKey };
  });
}

export function cleanupWhisperHandlers() {
  openAiApiKey = null;
}
