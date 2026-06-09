import { useEffect, useRef } from 'react';
import { Mic, Loader2 } from 'lucide-react';
import { useDictation } from '../../hooks/useDictation';
import { useSettingsStore } from '../../stores/settingsStore';
import { findEditor } from '../../utils/monacoEditorRegistry';
import { findTerminal } from '../../utils/terminalRegistry';

/**
 * DictationOverlay - Global component that handles push-to-talk dictation
 *
 * Listens for keyboard shortcuts, manages recording state, and shows
 * a visual indicator when recording/transcribing.
 */
export function DictationOverlay() {
  const { state, startRecording, stopRecording, isEnabled } = useDictation();
  const { settings } = useSettingsStore();
  const dictationSettings = settings.input.dictation;

  const isRecordingRef = useRef(false);
  const pendingTranscriptionRef = useRef<Promise<string | null> | null>(null);
  const targetElementRef = useRef<Element | null>(null);

  // Parse shortcut string into modifier flags and key
  const parseShortcut = (shortcut: string) => {
    const parts = shortcut.toLowerCase().split('+');
    return {
      cmdOrCtrl: parts.includes('commandorcontrol'),
      shift: parts.includes('shift'),
      alt: parts.includes('alt'),
      key: parts[parts.length - 1].toLowerCase(),
    };
  };

  useEffect(() => {
    if (!isEnabled) return;

    const shortcut = parseShortcut(dictationSettings.shortcut);
    const isMac = navigator.platform.toLowerCase().includes('mac');

    const handleKeyDown = async (e: KeyboardEvent) => {
      // Check if shortcut matches
      const modifierMatch = isMac
        ? (shortcut.cmdOrCtrl ? e.metaKey : true)
        : (shortcut.cmdOrCtrl ? e.ctrlKey : true);

      const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;
      const altMatch = shortcut.alt ? e.altKey : !e.altKey;
      const keyMatch = e.key.toLowerCase() === shortcut.key;

      if (modifierMatch && shiftMatch && altMatch && keyMatch) {
        e.preventDefault();
        e.stopPropagation();

        // Start recording if not already
        if (!isRecordingRef.current) {
          // Capture the focused element NOW, before async work changes focus
          targetElementRef.current = document.activeElement;
          isRecordingRef.current = true;
          await startRecording();
        }
      }
    };

    const finishRecording = async () => {
      if (!isRecordingRef.current) return;
      isRecordingRef.current = false;

      // Stop recording and get transcription
      pendingTranscriptionRef.current = stopRecording();
      const text = await pendingTranscriptionRef.current;
      pendingTranscriptionRef.current = null;

      if (text) {
        console.log('[Dictation] Transcribed text:', text);
        // Insert text into the element that was focused when recording started
        insertTextAtCursor(text, targetElementRef.current);
        targetElementRef.current = null;
      }
    };

    const handleKeyUp = async (e: KeyboardEvent) => {
      if (!isRecordingRef.current) return;

      const releasedKey = e.key.toLowerCase();

      // Stop recording if the main key OR a required modifier key is released.
      // On macOS, releasing a letter key while Cmd is held often doesn't fire
      // a keyup for the letter, so we must also stop when Cmd itself is released.
      const isMainKey = releasedKey === shortcut.key;
      const isRequiredModifier =
        (shortcut.cmdOrCtrl && (releasedKey === 'meta' || releasedKey === 'control')) ||
        (shortcut.shift && releasedKey === 'shift') ||
        (shortcut.alt && releasedKey === 'alt');

      if (isMainKey || isRequiredModifier) {
        e.preventDefault();
        e.stopPropagation();
        await finishRecording();
      }
    };

    // Also stop recording if the window loses focus
    const handleBlur = () => {
      finishRecording();
    };

    // Listen at capture phase to intercept before other handlers
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isEnabled, dictationSettings.shortcut, startRecording, stopRecording]);

  // Don't render anything if dictation is not active
  if (!state.isRecording && !state.isTranscribing) {
    return null;
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className={`
        flex items-center gap-3 px-5 py-3 rounded-full
        backdrop-blur-xl border shadow-2xl
        ${state.isRecording
          ? 'bg-red-500/20 border-red-500/50'
          : 'bg-[var(--holo-accent)]/20 border-[var(--holo-accent)]/50'
        }
      `}>
        {state.isRecording ? (
          <>
            <div className="relative">
              <Mic size={20} className="text-red-400" />
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            </div>
            <span className="text-sm font-medium text-red-300">Recording...</span>
            <AudioWaveform />
          </>
        ) : (
          <>
            <Loader2 size={20} className="text-[var(--holo-accent)] animate-spin" />
            <span className="text-sm font-medium text-[var(--holo-text)]">Transcribing...</span>
          </>
        )}
      </div>

      {state.error && (
        <div className="mt-2 px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-xs text-center">
          {state.error}
        </div>
      )}
    </div>
  );
}

/**
 * Simple animated waveform visualization
 */
const WAVEFORM_BAR_HEIGHTS = [60, 90, 45, 75, 50];

function AudioWaveform() {
  return (
    <div className="flex items-center gap-0.5 h-4">
      {WAVEFORM_BAR_HEIGHTS.map((height, i) => (
        <div
          key={i}
          className="w-1 bg-red-400 rounded-full animate-pulse"
          style={{
            height: `${height}%`,
            animationDelay: `${i * 0.1}s`,
            animationDuration: '0.5s',
          }}
        />
      ))}
    </div>
  );
}

/**
 * Insert text at the cursor position of the given target element.
 * Falls back to document.activeElement if no target is provided.
 * Works with regular inputs, contenteditable, and Monaco editor.
 */
function insertTextAtCursor(text: string, target: Element | null) {
  const element = target || document.activeElement;

  // Check if target is inside an xterm terminal FIRST
  // (xterm uses a hidden .xterm-helper-textarea which is an HTMLTextAreaElement,
  // so this must come before the generic textarea/input check)
  const xtermContainer = element instanceof HTMLElement
    ? element.closest('.xterm')
    : null;

  if (xtermContainer) {
    const terminalInstance = findTerminal(xtermContainer);
    if (terminalInstance) {
      terminalInstance.paste(text);
      return;
    }
  }

  // Check if it's a textarea or input
  if (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLInputElement
  ) {
    element.focus();
    const start = element.selectionStart || 0;
    const end = element.selectionEnd || 0;
    const value = element.value;

    element.value = value.slice(0, start) + text + value.slice(end);

    const newPosition = start + text.length;
    element.setSelectionRange(newPosition, newPosition);

    // Trigger input event for React
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // Check if target is inside a Monaco editor
  const monacoContainer = element instanceof HTMLElement
    ? element.closest('.monaco-editor')
    : null;

  if (monacoContainer) {
    const editorInstance = findEditor(monacoContainer);
    if (editorInstance) {
      editorInstance.focus();
      editorInstance.trigger('dictation', 'type', { text });
      return;
    }
  }

  // Check for contenteditable elements
  if (element instanceof HTMLElement && element.contentEditable === 'true') {
    element.focus();
    document.execCommand('insertText', false, text);
    return;
  }

  // Last resort: try any focused terminal
  const focusedTerminal = findTerminal();
  if (focusedTerminal) {
    focusedTerminal.paste(text);
    return;
  }

  // Last resort: try any focused Monaco editor (target may not have had .monaco-editor ancestor)
  const focusedEditor = findEditor();
  if (focusedEditor) {
    focusedEditor.focus();
    focusedEditor.trigger('dictation', 'type', { text });
    return;
  }

  // Fallback: dispatch a custom event that components can listen for
  console.warn('[Dictation] No suitable target found for text insertion');
  window.dispatchEvent(new CustomEvent('dictation:insert', { detail: { text } }));
}

export default DictationOverlay;
