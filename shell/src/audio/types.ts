/**
 * Sound System Types
 * Core type definitions for the viewer's audio system.
 */

export type OscillatorType = 'sine' | 'triangle' | 'square' | 'sawtooth';

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peaking';

export type SoundCategory =
  | 'tap'
  | 'blip'
  | 'chime'
  | 'slide'
  | 'tone'
  | 'fizz'
  | 'rise'
  | 'fall'
  | 'sequence'
  | 'pulse'
  | 'shimmer'
  | 'whoosh';

export type ViewerEvent =
  // Window events
  | 'window:open'
  | 'window:close'
  | 'window:focus'
  | 'window:minimize'
  | 'window:maximize'
  | 'window:drag'
  | 'window:resize'
  // Tab events
  | 'tab:add'
  | 'tab:remove'
  | 'tab:switch'
  | 'tab:reorder'
  | 'tab:tearOff'
  // File explorer events
  | 'file:select'
  | 'folder:expand'
  | 'folder:collapse'
  | 'file:open'
  // Workspace events
  | 'workspace:switch'
  | 'workspace:reorder'
  // Dialog events
  | 'dialog:open'
  | 'dialog:close'
  | 'dialog:confirm'
  | 'dialog:cancel'
  // Search events
  | 'search:navigate'
  // Other events
  | 'shortcut:activate'
  | 'drag:start'
  | 'drag:end'
  | 'workspace:tile';

export interface FilterParameters {
  type: FilterType;
  frequency: number;
  Q?: number;
  gain?: number; // For peaking filter
}

export interface ToneParameters {
  frequency: number;
  duration: number;
  type?: OscillatorType;
  volume?: number;
  attack?: number;
  decay?: number;
  sustain?: number; // Sustain level (0-1)
  release?: number; // Release time
  detune?: number;
  freqEnd?: number;
  vibrato?: number;
  vibratoRate?: number;
  // New parameters
  filter?: FilterParameters;
  harmonics?: number[]; // Array of harmonic multipliers/volumes
  distortion?: number; // 0-1 distortion amount
  delay?: {
    time: number; // Delay time in seconds
    feedback: number; // 0-1 feedback amount
    mix: number; // 0-1 wet/dry mix
  };
  pan?: number; // -1 to 1 stereo panning
  pitchEnvelope?: {
    start: number; // Starting frequency multiplier
    end: number; // Ending frequency multiplier
    time: number; // Time for pitch sweep
  };
}

export interface SoundDefinition {
  id: string;
  name: string;
  category: SoundCategory;
  // Either preset function name or custom parameters
  preset?: string;
  parameters?: ToneParameters[];
  stagger?: number;
  includeNoise?: {
    duration: number;
    volume: number;
    attack: number;
    decay: number;
  };
}

export interface EventBinding {
  event: ViewerEvent;
  soundId: string;
  enabled: boolean;
}

export interface SoundSystemConfig {
  version: 1;
  masterVolume: number;
  muted: boolean;
  eventBindings: EventBinding[];
  customSounds: SoundDefinition[];
}

export const ALL_EVENTS: ViewerEvent[] = [
  'window:open',
  'window:close',
  'window:focus',
  'window:minimize',
  'window:maximize',
  'window:drag',
  'window:resize',
  'tab:add',
  'tab:remove',
  'tab:switch',
  'tab:reorder',
  'tab:tearOff',
  'file:select',
  'folder:expand',
  'folder:collapse',
  'file:open',
  'workspace:switch',
  'workspace:reorder',
  'dialog:open',
  'dialog:close',
  'dialog:confirm',
  'dialog:cancel',
  'search:navigate',
  'shortcut:activate',
  'drag:start',
  'drag:end',
  'workspace:tile',
];

export const EVENT_LABELS: Record<ViewerEvent, string> = {
  'window:open': 'Window Open',
  'window:close': 'Window Close',
  'window:focus': 'Window Focus',
  'window:minimize': 'Window Minimize',
  'window:maximize': 'Window Maximize',
  'window:drag': 'Window Drag',
  'window:resize': 'Window Resize',
  'tab:add': 'Tab Add',
  'tab:remove': 'Tab Remove',
  'tab:switch': 'Tab Switch',
  'tab:reorder': 'Tab Reorder',
  'tab:tearOff': 'Tab Tear Off',
  'file:select': 'File Select',
  'folder:expand': 'Folder Expand',
  'folder:collapse': 'Folder Collapse',
  'file:open': 'File Open',
  'workspace:switch': 'Workspace Switch',
  'workspace:reorder': 'Workspace Reorder',
  'dialog:open': 'Dialog Open',
  'dialog:close': 'Dialog Close',
  'dialog:confirm': 'Dialog Confirm',
  'dialog:cancel': 'Dialog Cancel',
  'search:navigate': 'Search Navigate',
  'shortcut:activate': 'Shortcut Activate',
  'drag:start': 'Drag Start',
  'drag:end': 'Drag End',
  'workspace:tile': 'Toggle Organization',
};

export const CATEGORY_LABELS: Record<SoundCategory, string> = {
  tap: 'Tap',
  blip: 'Blip',
  chime: 'Chime',
  slide: 'Slide',
  tone: 'Tone',
  fizz: 'Fizz',
  rise: 'Rise',
  fall: 'Fall',
  sequence: 'Sequence',
  pulse: 'Pulse',
  shimmer: 'Shimmer',
  whoosh: 'Whoosh',
};
