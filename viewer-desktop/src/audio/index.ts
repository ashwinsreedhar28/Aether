/**
 * Audio Module
 * Re-exports all audio functionality.
 */

// Core engine
export { soundEngine, SoundEngine } from './soundEngine';

// Synthesis
export {
  initAudio,
  playTone,
  playMultiTone,
  playNoiseBurst,
  playCustomSound,
  setMasterVolume,
  getMasterVolume,
  setMuted,
  isMuted,
  getAnalyser,
  getAudioContext,
} from './synthesis';

// Presets
export {
  presetFunctions,
  presetDefinitions,
  getSoundsByCategory,
  playPreset,
  // Individual sound functions
  tap,
  tapSoft,
  tapLight,
  tapMuted,
  blip,
  blipDouble,
  blipQuad,
  blipHigh,
  blipLow,
  chimeUp,
  chimeUpDouble,
  chimeSuccess,
  chimeBright,
  chimeTriple,
  slideDown,
  slideSettle,
  slideClose,
  slideSoft,
  toneInfo,
  toneConfirm,
  toneSwitch,
  tonePing,
  toneSoft,
  toneBright,
  fizzShort,
  fizzSpark,
  fizzCrackle,
  fizzZap,
  fizzStatic,
  riseShort,
  riseMedium,
  riseLong,
  riseShimmer,
  fallShort,
  fallMedium,
  fallLong,
  sequenceBoot,
  sequenceComplete,
  sequenceAlert,
  sequencePower,
  sequenceData,
  pulseSoft,
  pulseQuick,
  pulseHeartbeat,
  shimmerShort,
  shimmerLong,
  shimmerSparkle,
  whooshUp,
  whooshDown,
  whooshQuick,
} from './presetSounds';

// Default bindings
export { defaultEventSoundMap, getDefaultBindings } from './defaultBindings';

// Types
export type {
  OscillatorType,
  FilterType,
  SoundCategory,
  ViewerEvent,
  ToneParameters,
  FilterParameters,
  SoundDefinition,
  EventBinding,
  SoundSystemConfig,
} from './types';

export { ALL_EVENTS, EVENT_LABELS, CATEGORY_LABELS } from './types';
