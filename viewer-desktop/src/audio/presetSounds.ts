/**
 * Preset Sound Definitions
 * All 50 preset sounds organized by category.
 * Each sound is defined with its synthesis parameters.
 */

import type { SoundDefinition, SoundCategory } from './types';
import { playTone, playMultiTone, playNoiseBurst } from './synthesis';

// ========== TAP FAMILY ==========
// Short, crisp, percussive sounds

export function tap(): void {
  playMultiTone([
    { frequency: 3200, duration: 0.025, volume: 0.08, attack: 0.0005, decay: 0.015 },
    { frequency: 4800, duration: 0.015, volume: 0.04, attack: 0.0005, decay: 0.01 },
  ]);
}

export function tapSoft(): void {
  playMultiTone([
    { frequency: 4000, duration: 0.02, volume: 0.03, attack: 0.001, decay: 0.015 },
    { frequency: 6000, duration: 0.015, volume: 0.015, attack: 0.001, decay: 0.01 },
  ]);
}

export function tapLight(): void {
  playTone({ frequency: 5000, duration: 0.015, volume: 0.02, attack: 0.0005, decay: 0.01 });
}

export function tapMuted(): void {
  playTone({ frequency: 2400, duration: 0.02, volume: 0.05, attack: 0.0005, decay: 0.012 });
}

// ========== BLIP FAMILY ==========
// Very short digital bleeps

export function blip(): void {
  playTone({ frequency: 4200, duration: 0.018, volume: 0.04, attack: 0.0005, decay: 0.012 });
}

export function blipDouble(): void {
  playMultiTone(
    [
      { frequency: 4200, duration: 0.018, volume: 0.04, attack: 0.0005, decay: 0.012 },
      { frequency: 4400, duration: 0.018, volume: 0.04, attack: 0.0005, decay: 0.012 },
    ],
    0.025
  );
}

export function blipQuad(): void {
  playMultiTone(
    [
      { frequency: 4000, duration: 0.018, volume: 0.035, attack: 0.0005, decay: 0.012 },
      { frequency: 4200, duration: 0.018, volume: 0.04, attack: 0.0005, decay: 0.012 },
      { frequency: 4400, duration: 0.018, volume: 0.04, attack: 0.0005, decay: 0.012 },
      { frequency: 4600, duration: 0.018, volume: 0.045, attack: 0.0005, decay: 0.012 },
    ],
    0.022
  );
}

export function blipHigh(): void {
  playTone({ frequency: 5500, duration: 0.015, volume: 0.035, attack: 0.0005, decay: 0.01 });
}

export function blipLow(): void {
  playTone({ frequency: 3000, duration: 0.022, volume: 0.05, attack: 0.0005, decay: 0.015 });
}

// ========== CHIME FAMILY ==========
// Ascending, pleasant, confirmation sounds

export function chimeUp(): void {
  playMultiTone(
    [
      { frequency: 2400, duration: 0.035, volume: 0.06, attack: 0.001, decay: 0.02 },
      { frequency: 3600, duration: 0.04, volume: 0.05, attack: 0.001, decay: 0.025 },
    ],
    0.015
  );
}

export function chimeUpDouble(): void {
  playMultiTone(
    [
      { frequency: 1800, duration: 0.03, volume: 0.05, attack: 0.001, decay: 0.02 },
      { frequency: 2800, duration: 0.04, volume: 0.06, attack: 0.001, decay: 0.025 },
    ],
    0.012
  );
}

export function chimeSuccess(): void {
  playMultiTone(
    [
      { frequency: 1800, duration: 0.05, volume: 0.06, attack: 0.001, decay: 0.03 },
      { frequency: 2700, duration: 0.07, volume: 0.07, attack: 0.001, decay: 0.04 },
    ],
    0.04
  );
}

export function chimeBright(): void {
  playMultiTone(
    [
      { frequency: 2800, duration: 0.04, volume: 0.06, attack: 0.001, decay: 0.025 },
      { frequency: 4200, duration: 0.05, volume: 0.05, attack: 0.001, decay: 0.03 },
    ],
    0.02
  );
}

export function chimeTriple(): void {
  playMultiTone(
    [
      { frequency: 2000, duration: 0.035, volume: 0.05, attack: 0.001, decay: 0.02 },
      { frequency: 2800, duration: 0.04, volume: 0.06, attack: 0.001, decay: 0.025 },
      { frequency: 3600, duration: 0.045, volume: 0.06, attack: 0.001, decay: 0.03 },
    ],
    0.025
  );
}

// ========== SLIDE FAMILY ==========
// Descending, release sounds

export function slideDown(): void {
  playMultiTone(
    [
      { frequency: 3200, duration: 0.03, volume: 0.05, attack: 0.001, decay: 0.02 },
      { frequency: 2000, duration: 0.035, volume: 0.04, attack: 0.001, decay: 0.02 },
    ],
    0.012
  );
}

export function slideSettle(): void {
  playTone({ frequency: 2400, duration: 0.05, volume: 0.06, attack: 0.001, decay: 0.03 });
}

export function slideClose(): void {
  playMultiTone(
    [
      { frequency: 2800, duration: 0.035, volume: 0.045, attack: 0.001, decay: 0.02 },
      { frequency: 1800, duration: 0.04, volume: 0.035, attack: 0.001, decay: 0.025 },
    ],
    0.015
  );
}

export function slideSoft(): void {
  playTone({ frequency: 3000, duration: 0.04, volume: 0.04, attack: 0.001, decay: 0.025, freqEnd: 2200 });
}

// ========== TONE FAMILY ==========
// Neutral, informational sounds

export function toneInfo(): void {
  playMultiTone(
    [
      { frequency: 2200, duration: 0.04, volume: 0.06, attack: 0.001, decay: 0.025 },
      { frequency: 2800, duration: 0.04, volume: 0.045, attack: 0.001, decay: 0.025 },
    ],
    0.05
  );
}

export function toneConfirm(): void {
  playMultiTone(
    [
      { frequency: 2200, duration: 0.035, volume: 0.06, attack: 0.001, decay: 0.02 },
      { frequency: 3300, duration: 0.045, volume: 0.05, attack: 0.001, decay: 0.03, type: 'triangle' },
    ],
    0.02
  );
}

export function toneSwitch(): void {
  playMultiTone([
    { frequency: 2200, duration: 0.045, volume: 0.06, attack: 0.001, decay: 0.03, type: 'triangle' },
    { frequency: 3300, duration: 0.03, volume: 0.035, attack: 0.001, decay: 0.02 },
  ]);
}

export function tonePing(): void {
  playTone({ frequency: 2600, duration: 0.05, volume: 0.06, attack: 0.001, decay: 0.03 });
}

export function toneSoft(): void {
  playTone({ frequency: 2000, duration: 0.04, volume: 0.045, attack: 0.002, decay: 0.025 });
}

export function toneBright(): void {
  playMultiTone([
    { frequency: 3000, duration: 0.04, volume: 0.06, attack: 0.001, decay: 0.025 },
    { frequency: 4500, duration: 0.03, volume: 0.035, attack: 0.001, decay: 0.02 },
  ]);
}

// ========== FIZZ FAMILY ==========
// Electric, crackling sounds

export function fizzShort(): void {
  playTone({ frequency: 3500, duration: 0.03, volume: 0.04, attack: 0.001, decay: 0.02, freqEnd: 5000 });
  playNoiseBurst(0.04, 0.06, 0.001, 0.025);
}

export function fizzSpark(): void {
  playMultiTone([
    { frequency: 4000, duration: 0.015, volume: 0.05, attack: 0.0005, decay: 0.01 },
    { frequency: 5500, duration: 0.012, volume: 0.035, attack: 0.0005, decay: 0.008 },
  ]);
  playNoiseBurst(0.025, 0.07, 0.0005, 0.015);
}

export function fizzCrackle(): void {
  playTone({ frequency: 2800, duration: 0.05, volume: 0.035, attack: 0.001, decay: 0.03, freqEnd: 4500 });
  playNoiseBurst(0.06, 0.05, 0.002, 0.04);
}

export function fizzZap(): void {
  playTone({ frequency: 3000, duration: 0.03, volume: 0.07, attack: 0.0005, decay: 0.02, freqEnd: 6000 });
  playNoiseBurst(0.02, 0.04, 0.0005, 0.012);
}

export function fizzStatic(): void {
  playTone({ frequency: 3200, duration: 0.04, volume: 0.03, attack: 0.001, decay: 0.03 });
  playNoiseBurst(0.05, 0.04, 0.001, 0.035);
}

// ========== RISE FAMILY ==========
// Longer ascending sounds

export function riseShort(): void {
  playTone({ frequency: 1500, duration: 0.1, volume: 0.06, attack: 0.002, decay: 0.05, freqEnd: 3500 });
}

export function riseMedium(): void {
  playTone({ frequency: 1200, duration: 0.18, volume: 0.06, attack: 0.005, decay: 0.08, freqEnd: 3800 });
}

export function riseLong(): void {
  playTone({ frequency: 800, duration: 0.3, volume: 0.06, attack: 0.01, decay: 0.15, freqEnd: 4000 });
}

export function riseShimmer(): void {
  playTone({ frequency: 1000, duration: 0.25, volume: 0.06, attack: 0.005, decay: 0.12, freqEnd: 3200 });
  playTone({
    frequency: 4000,
    duration: 0.2,
    volume: 0.025,
    attack: 0.01,
    decay: 0.1,
    freqEnd: 6000,
    vibrato: 30,
    vibratoRate: 20,
  });
}

// ========== FALL FAMILY ==========
// Longer descending sounds

export function fallShort(): void {
  playTone({ frequency: 3500, duration: 0.1, volume: 0.06, attack: 0.002, decay: 0.05, freqEnd: 1500 });
}

export function fallMedium(): void {
  playTone({ frequency: 3800, duration: 0.18, volume: 0.06, attack: 0.005, decay: 0.08, freqEnd: 1200 });
}

export function fallLong(): void {
  playTone({ frequency: 4000, duration: 0.35, volume: 0.06, attack: 0.01, decay: 0.18, freqEnd: 600 });
}

// ========== SEQUENCE FAMILY ==========
// Multi-part longer sounds

export function sequenceBoot(): void {
  playMultiTone(
    [
      { frequency: 800, duration: 0.06, volume: 0.04, attack: 0.001, decay: 0.04 },
      { frequency: 1200, duration: 0.05, volume: 0.05, attack: 0.001, decay: 0.035 },
      { frequency: 1800, duration: 0.05, volume: 0.06, attack: 0.001, decay: 0.035 },
      { frequency: 2700, duration: 0.08, volume: 0.07, attack: 0.001, decay: 0.05 },
    ],
    0.055
  );
}

export function sequenceComplete(): void {
  playMultiTone(
    [
      { frequency: 1600, duration: 0.04, volume: 0.05, attack: 0.001, decay: 0.025 },
      { frequency: 2400, duration: 0.05, volume: 0.06, attack: 0.001, decay: 0.03 },
      { frequency: 3200, duration: 0.06, volume: 0.06, attack: 0.001, decay: 0.04 },
    ],
    0.035
  );
}

export function sequenceAlert(): void {
  playMultiTone(
    [
      { frequency: 2400, duration: 0.05, volume: 0.06, attack: 0.001, decay: 0.03 },
      { frequency: 2600, duration: 0.05, volume: 0.06, attack: 0.001, decay: 0.03 },
      { frequency: 2400, duration: 0.05, volume: 0.06, attack: 0.001, decay: 0.03 },
    ],
    0.06
  );
}

export function sequencePower(): void {
  playMultiTone(
    [
      { frequency: 400, duration: 0.12, volume: 0.04, attack: 0.005, decay: 0.06, freqEnd: 800 },
      { frequency: 800, duration: 0.12, volume: 0.05, attack: 0.005, decay: 0.06, freqEnd: 1600 },
      { frequency: 1600, duration: 0.15, volume: 0.06, attack: 0.005, decay: 0.08, freqEnd: 3200 },
    ],
    0.08
  );
}

export function sequenceData(): void {
  playMultiTone(
    [
      { frequency: 3800, duration: 0.02, volume: 0.04, attack: 0.0005, decay: 0.012 },
      { frequency: 4200, duration: 0.02, volume: 0.04, attack: 0.0005, decay: 0.012 },
      { frequency: 4000, duration: 0.02, volume: 0.04, attack: 0.0005, decay: 0.012 },
      { frequency: 4400, duration: 0.02, volume: 0.045, attack: 0.0005, decay: 0.012 },
      { frequency: 4200, duration: 0.02, volume: 0.04, attack: 0.0005, decay: 0.012 },
      { frequency: 4600, duration: 0.025, volume: 0.05, attack: 0.0005, decay: 0.015 },
    ],
    0.025
  );
}

// ========== PULSE FAMILY ==========
// Rhythmic, pulsing sounds

export function pulseSoft(): void {
  playMultiTone(
    [
      { frequency: 2200, duration: 0.04, volume: 0.05, attack: 0.002, decay: 0.025 },
      { frequency: 2200, duration: 0.04, volume: 0.04, attack: 0.002, decay: 0.025 },
    ],
    0.06
  );
}

export function pulseQuick(): void {
  playMultiTone(
    [
      { frequency: 2800, duration: 0.025, volume: 0.05, attack: 0.001, decay: 0.015 },
      { frequency: 2800, duration: 0.025, volume: 0.04, attack: 0.001, decay: 0.015 },
      { frequency: 2800, duration: 0.025, volume: 0.03, attack: 0.001, decay: 0.015 },
    ],
    0.03
  );
}

export function pulseHeartbeat(): void {
  playMultiTone(
    [
      { frequency: 1800, duration: 0.04, volume: 0.06, attack: 0.001, decay: 0.025 },
      { frequency: 2200, duration: 0.035, volume: 0.05, attack: 0.001, decay: 0.02 },
    ],
    0.025
  );
}

// ========== SHIMMER FAMILY ==========
// Sparkly, shimmering sounds

export function shimmerShort(): void {
  playMultiTone(
    [
      { frequency: 4000, duration: 0.04, volume: 0.035, attack: 0.002, decay: 0.025 },
      { frequency: 5000, duration: 0.035, volume: 0.03, attack: 0.003, decay: 0.02 },
      { frequency: 6000, duration: 0.03, volume: 0.02, attack: 0.004, decay: 0.018 },
    ],
    0.008
  );
}

export function shimmerLong(): void {
  playMultiTone(
    [
      { frequency: 3500, duration: 0.12, volume: 0.04, attack: 0.005, decay: 0.08, vibrato: 15, vibratoRate: 12 },
      { frequency: 4500, duration: 0.1, volume: 0.035, attack: 0.008, decay: 0.06, vibrato: 20, vibratoRate: 15 },
      { frequency: 5500, duration: 0.08, volume: 0.03, attack: 0.01, decay: 0.05, vibrato: 25, vibratoRate: 18 },
    ],
    0.02
  );
}

export function shimmerSparkle(): void {
  playMultiTone(
    [
      { frequency: 5000, duration: 0.025, volume: 0.04, attack: 0.001, decay: 0.015 },
      { frequency: 6000, duration: 0.02, volume: 0.035, attack: 0.001, decay: 0.012 },
      { frequency: 7000, duration: 0.018, volume: 0.03, attack: 0.001, decay: 0.01 },
      { frequency: 5500, duration: 0.022, volume: 0.03, attack: 0.001, decay: 0.013 },
    ],
    0.012
  );
}

// ========== WHOOSH FAMILY ==========
// Sweeping sounds

export function whooshUp(): void {
  playTone({ frequency: 800, duration: 0.12, volume: 0.05, attack: 0.002, decay: 0.06, freqEnd: 4000 });
  playNoiseBurst(0.1, 0.025, 0.002, 0.06);
}

export function whooshDown(): void {
  playTone({ frequency: 4000, duration: 0.12, volume: 0.05, attack: 0.002, decay: 0.06, freqEnd: 800 });
  playNoiseBurst(0.1, 0.025, 0.002, 0.06);
}

export function whooshQuick(): void {
  playTone({ frequency: 1500, duration: 0.06, volume: 0.05, attack: 0.001, decay: 0.035, freqEnd: 4500 });
}

// ========== PRESET REGISTRY ==========

export const presetFunctions: Record<string, () => void> = {
  // Tap
  tap,
  tapSoft,
  tapLight,
  tapMuted,
  // Blip
  blip,
  blipDouble,
  blipQuad,
  blipHigh,
  blipLow,
  // Chime
  chimeUp,
  chimeUpDouble,
  chimeSuccess,
  chimeBright,
  chimeTriple,
  // Slide
  slideDown,
  slideSettle,
  slideClose,
  slideSoft,
  // Tone
  toneInfo,
  toneConfirm,
  toneSwitch,
  tonePing,
  toneSoft,
  toneBright,
  // Fizz
  fizzShort,
  fizzSpark,
  fizzCrackle,
  fizzZap,
  fizzStatic,
  // Rise
  riseShort,
  riseMedium,
  riseLong,
  riseShimmer,
  // Fall
  fallShort,
  fallMedium,
  fallLong,
  // Sequence
  sequenceBoot,
  sequenceComplete,
  sequenceAlert,
  sequencePower,
  sequenceData,
  // Pulse
  pulseSoft,
  pulseQuick,
  pulseHeartbeat,
  // Shimmer
  shimmerShort,
  shimmerLong,
  shimmerSparkle,
  // Whoosh
  whooshUp,
  whooshDown,
  whooshQuick,
};

export const presetDefinitions: SoundDefinition[] = [
  // Tap family
  { id: 'tap', name: 'Tap', category: 'tap', preset: 'tap' },
  { id: 'tapSoft', name: 'Tap Soft', category: 'tap', preset: 'tapSoft' },
  { id: 'tapLight', name: 'Tap Light', category: 'tap', preset: 'tapLight' },
  { id: 'tapMuted', name: 'Tap Muted', category: 'tap', preset: 'tapMuted' },
  // Blip family
  { id: 'blip', name: 'Blip', category: 'blip', preset: 'blip' },
  { id: 'blipDouble', name: 'Blip Double', category: 'blip', preset: 'blipDouble' },
  { id: 'blipQuad', name: 'Blip Quad', category: 'blip', preset: 'blipQuad' },
  { id: 'blipHigh', name: 'Blip High', category: 'blip', preset: 'blipHigh' },
  { id: 'blipLow', name: 'Blip Low', category: 'blip', preset: 'blipLow' },
  // Chime family
  { id: 'chimeUp', name: 'Chime Up', category: 'chime', preset: 'chimeUp' },
  { id: 'chimeUpDouble', name: 'Chime Up Double', category: 'chime', preset: 'chimeUpDouble' },
  { id: 'chimeSuccess', name: 'Chime Success', category: 'chime', preset: 'chimeSuccess' },
  { id: 'chimeBright', name: 'Chime Bright', category: 'chime', preset: 'chimeBright' },
  { id: 'chimeTriple', name: 'Chime Triple', category: 'chime', preset: 'chimeTriple' },
  // Slide family
  { id: 'slideDown', name: 'Slide Down', category: 'slide', preset: 'slideDown' },
  { id: 'slideSettle', name: 'Slide Settle', category: 'slide', preset: 'slideSettle' },
  { id: 'slideClose', name: 'Slide Close', category: 'slide', preset: 'slideClose' },
  { id: 'slideSoft', name: 'Slide Soft', category: 'slide', preset: 'slideSoft' },
  // Tone family
  { id: 'toneInfo', name: 'Tone Info', category: 'tone', preset: 'toneInfo' },
  { id: 'toneConfirm', name: 'Tone Confirm', category: 'tone', preset: 'toneConfirm' },
  { id: 'toneSwitch', name: 'Tone Switch', category: 'tone', preset: 'toneSwitch' },
  { id: 'tonePing', name: 'Tone Ping', category: 'tone', preset: 'tonePing' },
  { id: 'toneSoft', name: 'Tone Soft', category: 'tone', preset: 'toneSoft' },
  { id: 'toneBright', name: 'Tone Bright', category: 'tone', preset: 'toneBright' },
  // Fizz family
  { id: 'fizzShort', name: 'Fizz Short', category: 'fizz', preset: 'fizzShort' },
  { id: 'fizzSpark', name: 'Fizz Spark', category: 'fizz', preset: 'fizzSpark' },
  { id: 'fizzCrackle', name: 'Fizz Crackle', category: 'fizz', preset: 'fizzCrackle' },
  { id: 'fizzZap', name: 'Fizz Zap', category: 'fizz', preset: 'fizzZap' },
  { id: 'fizzStatic', name: 'Fizz Static', category: 'fizz', preset: 'fizzStatic' },
  // Rise family
  { id: 'riseShort', name: 'Rise Short', category: 'rise', preset: 'riseShort' },
  { id: 'riseMedium', name: 'Rise Medium', category: 'rise', preset: 'riseMedium' },
  { id: 'riseLong', name: 'Rise Long', category: 'rise', preset: 'riseLong' },
  { id: 'riseShimmer', name: 'Rise Shimmer', category: 'rise', preset: 'riseShimmer' },
  // Fall family
  { id: 'fallShort', name: 'Fall Short', category: 'fall', preset: 'fallShort' },
  { id: 'fallMedium', name: 'Fall Medium', category: 'fall', preset: 'fallMedium' },
  { id: 'fallLong', name: 'Fall Long', category: 'fall', preset: 'fallLong' },
  // Sequence family
  { id: 'sequenceBoot', name: 'Sequence Boot', category: 'sequence', preset: 'sequenceBoot' },
  { id: 'sequenceComplete', name: 'Sequence Complete', category: 'sequence', preset: 'sequenceComplete' },
  { id: 'sequenceAlert', name: 'Sequence Alert', category: 'sequence', preset: 'sequenceAlert' },
  { id: 'sequencePower', name: 'Sequence Power', category: 'sequence', preset: 'sequencePower' },
  { id: 'sequenceData', name: 'Sequence Data', category: 'sequence', preset: 'sequenceData' },
  // Pulse family
  { id: 'pulseSoft', name: 'Pulse Soft', category: 'pulse', preset: 'pulseSoft' },
  { id: 'pulseQuick', name: 'Pulse Quick', category: 'pulse', preset: 'pulseQuick' },
  { id: 'pulseHeartbeat', name: 'Pulse Heartbeat', category: 'pulse', preset: 'pulseHeartbeat' },
  // Shimmer family
  { id: 'shimmerShort', name: 'Shimmer Short', category: 'shimmer', preset: 'shimmerShort' },
  { id: 'shimmerLong', name: 'Shimmer Long', category: 'shimmer', preset: 'shimmerLong' },
  { id: 'shimmerSparkle', name: 'Shimmer Sparkle', category: 'shimmer', preset: 'shimmerSparkle' },
  // Whoosh family
  { id: 'whooshUp', name: 'Whoosh Up', category: 'whoosh', preset: 'whooshUp' },
  { id: 'whooshDown', name: 'Whoosh Down', category: 'whoosh', preset: 'whooshDown' },
  { id: 'whooshQuick', name: 'Whoosh Quick', category: 'whoosh', preset: 'whooshQuick' },
];

export function getSoundsByCategory(category: SoundCategory): SoundDefinition[] {
  return presetDefinitions.filter((s) => s.category === category);
}

export function playPreset(id: string): void {
  const fn = presetFunctions[id];
  if (fn) {
    fn();
  }
}
