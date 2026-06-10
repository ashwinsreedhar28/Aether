import { useState, useEffect } from 'react';
import { Sun, Moon, Check } from 'lucide-react';
import { useSettingsStore } from '../../../stores/settingsStore';
import type { AccentColor, ColorScheme, ThemeSettings } from '../../../stores/settingsStore';

const ACCENT_OPTIONS: { id: AccentColor; label: string; color: string }[] = [
  { id: 'blue', label: 'Blue', color: '#4a9eff' },
  { id: 'purple', label: 'Purple', color: '#a855f7' },
  { id: 'green', label: 'Green', color: '#22c55e' },
  { id: 'orange', label: 'Orange', color: '#f97316' },
  { id: 'pink', label: 'Pink', color: '#ec4899' },
  { id: 'cyan', label: 'Cyan', color: '#06b6d4' },
];

const FONT_SIZE_OPTIONS: { id: ThemeSettings['fontSize']; label: string }[] = [
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
];

export function AppearanceSettings() {
  const settings = useSettingsStore((s) => s.settings);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const applyTheme = useSettingsStore((s) => s.applyTheme);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSettings().then(() => {
      applyTheme();
    }).finally(() => setIsLoading(false));
  }, [loadSettings, applyTheme]);

  const handleColorSchemeChange = (scheme: ColorScheme) => {
    setTheme({ colorScheme: scheme });
  };

  const handleAccentColorChange = (color: AccentColor) => {
    setTheme({ accentColor: color });
  };

  const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTheme({ windowOpacity: parseFloat(e.target.value) });
  };

  const handleFontSizeChange = (size: ThemeSettings['fontSize']) => {
    setTheme({ fontSize: size });
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-[var(--holo-muted)]">Loading settings...</div>
      </div>
    );
  }

  const theme = settings.theme;

  return (
    <div className="h-full p-6 overflow-auto">
      <div className="max-w-lg space-y-8">
        {/* Color Scheme */}
        <div>
          <h2 className="text-sm font-medium text-[var(--holo-text)] mb-1">
            Color Scheme
          </h2>
          <p className="text-xs text-[var(--holo-muted)] mb-4">
            Choose between dark and light mode for the interface.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => handleColorSchemeChange('dark')}
              className={`flex items-center gap-2 px-4 py-3 rounded-lg border transition-colors ${
                theme.colorScheme === 'dark'
                  ? 'bg-[var(--holo-accent)]/20 border-[var(--holo-accent)] text-[var(--holo-accent)]'
                  : 'bg-[var(--holo-border)]/10 border-[var(--holo-border)] text-[var(--holo-muted)] hover:border-[var(--holo-accent)]/50'
              }`}
            >
              <Moon size={16} />
              <span className="text-sm">Dark</span>
              {theme.colorScheme === 'dark' && <Check size={14} className="ml-1" />}
            </button>
            <button
              onClick={() => handleColorSchemeChange('light')}
              className={`flex items-center gap-2 px-4 py-3 rounded-lg border transition-colors ${
                theme.colorScheme === 'light'
                  ? 'bg-[var(--holo-accent)]/20 border-[var(--holo-accent)] text-[var(--holo-accent)]'
                  : 'bg-[var(--holo-border)]/10 border-[var(--holo-border)] text-[var(--holo-muted)] hover:border-[var(--holo-accent)]/50'
              }`}
            >
              <Sun size={16} />
              <span className="text-sm">Light</span>
              {theme.colorScheme === 'light' && <Check size={14} className="ml-1" />}
            </button>
          </div>
        </div>

        {/* Accent Color */}
        <div>
          <h2 className="text-sm font-medium text-[var(--holo-text)] mb-1">
            Accent Color
          </h2>
          <p className="text-xs text-[var(--holo-muted)] mb-4">
            Choose the primary accent color for buttons, links, and highlights.
          </p>
          <div className="flex gap-3 flex-wrap">
            {ACCENT_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => handleAccentColorChange(option.id)}
                className={`relative w-10 h-10 rounded-full border-2 transition-all ${
                  theme.accentColor === option.id
                    ? 'border-white scale-110 shadow-lg'
                    : 'border-transparent hover:scale-105'
                }`}
                style={{ backgroundColor: option.color }}
                title={option.label}
              >
                {theme.accentColor === option.id && (
                  <Check size={16} className="absolute inset-0 m-auto text-white drop-shadow-md" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Window Opacity */}
        <div>
          <h2 className="text-sm font-medium text-[var(--holo-text)] mb-1">
            Window Opacity
          </h2>
          <p className="text-xs text-[var(--holo-muted)] mb-4">
            Adjust the transparency of window backgrounds.
          </p>
          <div className="space-y-2">
            <input
              type="range"
              min="0.5"
              max="1"
              step="0.05"
              value={theme.windowOpacity}
              onChange={handleOpacityChange}
              className="w-full h-2 bg-[var(--holo-border)] rounded-lg appearance-none cursor-pointer accent-[var(--holo-accent)]"
            />
            <div className="flex justify-between text-xs text-[var(--holo-muted)]">
              <span>Translucent</span>
              <span>{Math.round(theme.windowOpacity * 100)}%</span>
              <span>Solid</span>
            </div>
          </div>
        </div>

        {/* Font Size */}
        <div>
          <h2 className="text-sm font-medium text-[var(--holo-text)] mb-1">
            Font Size
          </h2>
          <p className="text-xs text-[var(--holo-muted)] mb-4">
            Adjust the base font size for the interface.
          </p>
          <div className="flex gap-3">
            {FONT_SIZE_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => handleFontSizeChange(option.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                  theme.fontSize === option.id
                    ? 'bg-[var(--holo-accent)]/20 border-[var(--holo-accent)] text-[var(--holo-accent)]'
                    : 'bg-[var(--holo-border)]/10 border-[var(--holo-border)] text-[var(--holo-muted)] hover:border-[var(--holo-accent)]/50'
                }`}
              >
                <span className="text-sm">{option.label}</span>
                {theme.fontSize === option.id && <Check size={14} />}
              </button>
            ))}
          </div>
        </div>

        {/* Preview box */}
        <div className="p-4 bg-[var(--holo-accent)]/5 border border-[var(--holo-accent)]/20 rounded-lg">
          <h3 className="text-xs font-medium text-[var(--holo-accent)] mb-2 uppercase tracking-wider">
            Theme Preview
          </h3>
          <p className="text-xs text-[var(--holo-muted)]">
            Changes are applied immediately. Your preferences are automatically saved.
          </p>
        </div>
      </div>
    </div>
  );
}
