import { create } from 'zustand';

export type ColorScheme = 'dark' | 'light';
export type AccentColor = 'blue' | 'purple' | 'green' | 'orange' | 'pink' | 'cyan';
export type LeapCrosshairStyle = 'ironman' | 'minimal' | 'dot';
export type LeapHoverPrimaryHand = 'right' | 'left' | 'mostRecent';
export type LeapScrollFallbackMode = 'auto' | 'always' | 'never';
export type LeapScrollAxisMode = 'both' | 'vertical' | 'horizontal';

export interface ThemeSettings {
  colorScheme: ColorScheme;
  accentColor: AccentColor;
  windowOpacity: number; // 0.5 to 1.0
  fontSize: 'small' | 'medium' | 'large';
}

export interface LeapInputSettings {
  enabled: boolean;
  endpoint: string;
  reconnectMs: number;
  confidenceThreshold: number;
  staleHandMs: number;
  hoverMoveHz: number;
  hoverPrimaryHand: LeapHoverPrimaryHand;
  hideNativeCursor: boolean;
  smoothing: number;
  deadzonePx: number;
  edgePaddingPx: number;
  xMinMm: number;
  xMaxMm: number;
  yMinMm: number;
  yMaxMm: number;
  invertX: boolean;
  invertY: boolean;
  cursorGainX: number;
  cursorGainY: number;
  pinchThreshold: number;
  releaseThreshold: number;
  dragActivationPx: number;
  minPinchMsForClick: number;
  scrollFallbackMode: LeapScrollFallbackMode;
  scrollHoldDelayMs: number;
  scrollActivationPx: number;
  scrollAxisMode: LeapScrollAxisMode;
  scrollSensitivity: number;
  scrollSensitivityX: number;
  scrollSensitivityY: number;
  invertScrollX: boolean;
  invertScrollY: boolean;
  showCrosshairs: boolean;
  crosshairStyle: LeapCrosshairStyle;
}

export interface DictationSettings {
  enabled: boolean;
  openAiApiKey: string | null;
  model: 'whisper-1';
  language: string | null; // ISO 639-1 code, e.g., 'en', null for auto-detect
  shortcut: string; // e.g., 'CommandOrControl+Shift+D'
}

export interface InputSettings {
  leap: LeapInputSettings;
  dictation: DictationSettings;
}

export interface AppSettings {
  defaultProjectsFolder: string | null;
  theme: ThemeSettings;
  input: InputSettings;
}

export interface SettingsStore {
  settings: AppSettings;
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  setDefaultProjectsFolder: (folder: string | null) => void;
  setTheme: (theme: Partial<ThemeSettings>) => void;
  setLeapSettings: (settings: Partial<LeapInputSettings>) => void;
  setDictationSettings: (settings: Partial<DictationSettings>) => void;
  applyTheme: () => void;
}

const DEFAULT_THEME: ThemeSettings = {
  colorScheme: 'dark',
  accentColor: 'blue',
  windowOpacity: 0.95,
  fontSize: 'medium',
};

const DEFAULT_DICTATION: DictationSettings = {
  enabled: false,
  openAiApiKey: null,
  model: 'whisper-1',
  language: null,
  shortcut: 'CommandOrControl+Shift+D',
};

const DEFAULT_LEAP_INPUT: LeapInputSettings = {
  enabled: true,
  endpoint: 'ws://127.0.0.1:6437/v7.json',
  reconnectMs: 3000,
  confidenceThreshold: 0.2,
  staleHandMs: 220,
  hoverMoveHz: 30,
  hoverPrimaryHand: 'right',
  hideNativeCursor: true,
  smoothing: 0.35,
  deadzonePx: 0.8,
  edgePaddingPx: 0,
  xMinMm: -220,
  xMaxMm: 220,
  yMinMm: 90,
  yMaxMm: 420,
  invertX: false,
  invertY: false,
  cursorGainX: 1.0,
  cursorGainY: 1.0,
  pinchThreshold: 0.82,
  releaseThreshold: 0.62,
  dragActivationPx: 8,
  minPinchMsForClick: 0,
  scrollFallbackMode: 'auto',
  scrollHoldDelayMs: 120,
  scrollActivationPx: 14,
  scrollAxisMode: 'vertical',
  scrollSensitivity: 1.0,
  scrollSensitivityX: 1.0,
  scrollSensitivityY: 1.0,
  invertScrollX: false,
  invertScrollY: false,
  showCrosshairs: true,
  crosshairStyle: 'ironman',
};

const DEFAULT_SETTINGS: AppSettings = {
  defaultProjectsFolder: null,
  theme: DEFAULT_THEME,
  input: {
    leap: DEFAULT_LEAP_INPUT,
    dictation: DEFAULT_DICTATION,
  },
};

// Accent color definitions with their CSS values
export const ACCENT_COLORS: Record<AccentColor, { primary: string; rgb: string }> = {
  blue: { primary: '#4a9eff', rgb: '100, 150, 255' },
  purple: { primary: '#a855f7', rgb: '168, 85, 247' },
  green: { primary: '#22c55e', rgb: '34, 197, 94' },
  orange: { primary: '#f97316', rgb: '249, 115, 22' },
  pink: { primary: '#ec4899', rgb: '236, 72, 153' },
  cyan: { primary: '#06b6d4', rgb: '6, 182, 212' },
};

// Font size multipliers
const FONT_SIZES: Record<ThemeSettings['fontSize'], number> = {
  small: 0.875,
  medium: 1,
  large: 1.125,
};

function mergeSettings(raw: Partial<AppSettings> | undefined): AppSettings {
  return {
    defaultProjectsFolder: raw?.defaultProjectsFolder ?? DEFAULT_SETTINGS.defaultProjectsFolder,
    theme: {
      ...DEFAULT_THEME,
      ...(raw?.theme ?? {}),
    },
    input: {
      leap: {
        ...DEFAULT_LEAP_INPUT,
        ...(raw?.input?.leap ?? {}),
      },
      dictation: {
        ...DEFAULT_DICTATION,
        ...(raw?.input?.dictation ?? {}),
      },
    },
  };
}

function applyThemeToDOM(theme: ThemeSettings) {
  const root = document.documentElement;
  const accent = ACCENT_COLORS[theme.accentColor];

  // Apply accent color
  root.style.setProperty('--holo-accent', accent.primary);
  root.style.setProperty('--holo-accent-rgb', accent.rgb);
  root.style.setProperty('--holo-border', `rgba(${accent.rgb}, 0.2)`);
  root.style.setProperty('--holo-glow', `rgba(${accent.rgb}, 0.4)`);

  // Apply color scheme
  if (theme.colorScheme === 'light') {
    root.style.setProperty('--holo-bg', '#f5f5f7');
    root.style.setProperty('--holo-panel', 'rgba(255, 255, 255, 0.85)');
    root.style.setProperty('--holo-text', '#1a1a1a');
    root.style.setProperty('--holo-muted', '#666666');
  } else {
    root.style.setProperty('--holo-bg', '#0a0a0f');
    root.style.setProperty('--holo-panel', 'rgba(20, 20, 30, 0.8)');
    root.style.setProperty('--holo-text', '#e0e0e0');
    root.style.setProperty('--holo-muted', '#888888');
  }

  // Apply window opacity
  root.style.setProperty('--holo-window-opacity', theme.windowOpacity.toString());

  // Apply font size
  const fontMultiplier = FONT_SIZES[theme.fontSize];
  root.style.setProperty('--font-size-multiplier', fontMultiplier.toString());
  root.style.fontSize = `${fontMultiplier * 16}px`;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,

  loadSettings: async () => {
    try {
      const config = await window.electron.config.load();
      if (config?.appSettings) {
        set({ settings: mergeSettings(config.appSettings as Partial<AppSettings>) });
      }
    } catch {
      // Config doesn't exist yet
    }
  },

  saveSettings: async () => {
    try {
      const existingConfig = await window.electron.config.load() || {};
      const config = {
        ...existingConfig,
        appSettings: get().settings,
      };
      await window.electron.config.save(config as Parameters<typeof window.electron.config.save>[0]);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  },

  setDefaultProjectsFolder: (folder: string | null) => {
    set(state => ({
      settings: { ...state.settings, defaultProjectsFolder: folder },
    }));
    get().saveSettings();
  },

  setTheme: (themeUpdates: Partial<ThemeSettings>) => {
    set(state => ({
      settings: {
        ...state.settings,
        theme: { ...state.settings.theme, ...themeUpdates },
      },
    }));
    get().applyTheme();
    get().saveSettings();
  },

  setLeapSettings: (leapUpdates: Partial<LeapInputSettings>) => {
    set(state => ({
      settings: {
        ...state.settings,
        input: {
          ...state.settings.input,
          leap: {
            ...state.settings.input.leap,
            ...leapUpdates,
          },
        },
      },
    }));
    get().saveSettings();
  },

  setDictationSettings: (dictationUpdates: Partial<DictationSettings>) => {
    set(state => ({
      settings: {
        ...state.settings,
        input: {
          ...state.settings.input,
          dictation: {
            ...state.settings.input.dictation,
            ...dictationUpdates,
          },
        },
      },
    }));
    get().saveSettings();
  },

  applyTheme: () => {
    const { theme } = get().settings;
    applyThemeToDOM(theme);
  },
}));
