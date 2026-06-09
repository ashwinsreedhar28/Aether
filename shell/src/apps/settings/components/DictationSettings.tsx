import { useState, useEffect } from 'react';
import { Mic, Eye, EyeOff, Keyboard, Globe, Info } from 'lucide-react';
import { useSettingsStore } from '../../../stores/settingsStore';

const LANGUAGES = [
  { code: null, label: 'Auto-detect' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
];

export function DictationSettings() {
  const { settings, setDictationSettings } = useSettingsStore();
  const dictation = settings.input.dictation;
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(dictation.openAiApiKey || '');
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false);

  // Update local state when settings change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setApiKeyInput(dictation.openAiApiKey || '');
  }, [dictation.openAiApiKey]);

  const handleApiKeyChange = (value: string) => {
    setApiKeyInput(value);
  };

  const handleApiKeySave = () => {
    setDictationSettings({ openAiApiKey: apiKeyInput || null });
  };

  const handleShortcutCapture = (e: React.KeyboardEvent) => {
    if (!isRecordingShortcut) return;

    e.preventDefault();
    e.stopPropagation();

    const parts: string[] = [];

    // Build modifier string
    if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    // Get the key (ignore modifier-only presses)
    const key = e.key;
    if (!['Meta', 'Control', 'Shift', 'Alt'].includes(key)) {
      // Normalize key name
      const normalizedKey = key.length === 1 ? key.toUpperCase() : key;
      parts.push(normalizedKey);

      // Save the shortcut
      const shortcut = parts.join('+');
      setDictationSettings({ shortcut });
      setIsRecordingShortcut(false);
    }
  };

  const formatShortcut = (shortcut: string) => {
    const isMac = navigator.platform?.toUpperCase().includes('MAC') || navigator.userAgent?.includes('Mac');
    return shortcut
      .replace('CommandOrControl', isMac ? 'Cmd' : 'Ctrl')
      .replace(/\+/g, ' + ');
  };

  const isConfigured = dictation.enabled && dictation.openAiApiKey;

  return (
    <div className="h-full overflow-y-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[var(--holo-accent)]/20 flex items-center justify-center">
          <Mic size={20} className="text-[var(--holo-accent)]" />
        </div>
        <div>
          <h2 className="text-lg font-medium text-[var(--holo-text)]">Voice Dictation</h2>
          <p className="text-sm text-[var(--holo-muted)]">
            Transcribe speech to text using OpenAI Whisper
          </p>
        </div>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between p-4 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[var(--holo-border)]">
        <div>
          <div className="font-medium text-[var(--holo-text)]">Enable Dictation</div>
          <div className="text-sm text-[var(--holo-muted)]">
            Hold shortcut to record, release to transcribe
          </div>
        </div>
        <button
          onClick={() => setDictationSettings({ enabled: !dictation.enabled })}
          className={`relative w-12 h-6 rounded-full transition-colors ${
            dictation.enabled ? 'bg-[var(--holo-accent)]' : 'bg-[rgba(255,255,255,0.1)]'
          }`}
        >
          <div
            className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
              dictation.enabled ? 'translate-x-7' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* API Key */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-[var(--holo-text)]">
          <span>OpenAI API Key</span>
          <a
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--holo-accent)] hover:underline text-xs"
          >
            Get one
          </a>
        </label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKeyInput}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              onBlur={handleApiKeySave}
              placeholder="sk-..."
              className="w-full px-3 py-2 pr-10 rounded-lg bg-[rgba(255,255,255,0.05)] border border-[var(--holo-border)] text-[var(--holo-text)] placeholder:text-[var(--holo-muted)] focus:outline-none focus:border-[var(--holo-accent)]"
            />
            <button
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--holo-muted)] hover:text-[var(--holo-text)]"
            >
              {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        {!dictation.openAiApiKey && dictation.enabled && (
          <p className="text-xs text-orange-400 flex items-center gap-1">
            <Info size={12} />
            API key required for dictation to work
          </p>
        )}
      </div>

      {/* Shortcut */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-[var(--holo-text)]">
          <Keyboard size={14} />
          <span>Push-to-Talk Shortcut</span>
        </label>
        <button
          onClick={() => setIsRecordingShortcut(true)}
          onKeyDown={handleShortcutCapture}
          onBlur={() => setIsRecordingShortcut(false)}
          className={`w-full px-4 py-3 rounded-lg border text-left transition-colors ${
            isRecordingShortcut
              ? 'bg-[var(--holo-accent)]/20 border-[var(--holo-accent)] text-[var(--holo-accent)]'
              : 'bg-[rgba(255,255,255,0.05)] border-[var(--holo-border)] text-[var(--holo-text)]'
          }`}
        >
          {isRecordingShortcut ? (
            <span className="animate-pulse">Press your shortcut...</span>
          ) : (
            <span className="font-mono">{formatShortcut(dictation.shortcut)}</span>
          )}
        </button>
        <p className="text-xs text-[var(--holo-muted)]">
          Hold to record, release to transcribe and insert text at cursor
        </p>
      </div>

      {/* Language */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-[var(--holo-text)]">
          <Globe size={14} />
          <span>Language</span>
        </label>
        <select
          value={dictation.language || ''}
          onChange={(e) => setDictationSettings({ language: e.target.value || null })}
          className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.05)] border border-[var(--holo-border)] text-[var(--holo-text)] focus:outline-none focus:border-[var(--holo-accent)]"
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.code || 'auto'} value={lang.code || ''}>
              {lang.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-[var(--holo-muted)]">
          Hint language for better accuracy. Auto-detect works well for most cases.
        </p>
      </div>

      {/* Status indicator */}
      <div className={`p-4 rounded-lg border ${
        isConfigured
          ? 'bg-green-500/10 border-green-500/30'
          : 'bg-orange-500/10 border-orange-500/30'
      }`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            isConfigured ? 'bg-green-500' : 'bg-orange-500'
          }`} />
          <span className={`text-sm font-medium ${
            isConfigured ? 'text-green-400' : 'text-orange-400'
          }`}>
            {isConfigured ? 'Ready to use' : 'Setup required'}
          </span>
        </div>
        <p className={`text-xs mt-1 ${
          isConfigured ? 'text-green-400/70' : 'text-orange-400/70'
        }`}>
          {isConfigured
            ? `Press ${formatShortcut(dictation.shortcut)} anywhere to start dictating`
            : 'Enable dictation and add your OpenAI API key to get started'
          }
        </p>
      </div>

      {/* Usage tips */}
      <div className="p-4 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[var(--holo-border)]">
        <h3 className="text-sm font-medium text-[var(--holo-text)] mb-2">Tips</h3>
        <ul className="text-xs text-[var(--holo-muted)] space-y-1">
          <li>• Works in any text field, including Monaco editor</li>
          <li>• Speak clearly and at a natural pace</li>
          <li>• Recording indicator appears while holding the shortcut</li>
          <li>• Release the shortcut to send audio for transcription</li>
        </ul>
      </div>
    </div>
  );
}
