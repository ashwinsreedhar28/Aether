/**
 * Web Audio Synthesis Engine
 * Adapted from futuristic-sound-effects library.
 * Provides real-time audio synthesis for UI sound effects.
 */

import type { ToneParameters, FilterParameters } from './types';

let audioContext: AudioContext | null = null;
let masterGainNode: GainNode | null = null;
let analyserNode: AnalyserNode | null = null;
let masterVolume = 0.5;
let muted = false;

function getContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
    masterGainNode = audioContext.createGain();
    masterGainNode.gain.value = muted ? 0 : masterVolume;

    // Create analyser for visualization
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.8;

    masterGainNode.connect(analyserNode);
    analyserNode.connect(audioContext.destination);
  }
  return audioContext;
}

function getMasterGain(): GainNode {
  getContext(); // Ensure context is initialized
  return masterGainNode!;
}

export function getAnalyser(): AnalyserNode {
  getContext(); // Ensure context is initialized
  return analyserNode!;
}

export function getAudioContext(): AudioContext {
  return getContext();
}

export async function initAudio(): Promise<void> {
  const ctx = getContext();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
}

export function setMasterVolume(volume: number): void {
  masterVolume = Math.max(0, Math.min(1, volume));
  if (masterGainNode && !muted) {
    masterGainNode.gain.value = masterVolume;
  }
}

export function getMasterVolume(): number {
  return masterVolume;
}

export function setMuted(m: boolean): void {
  muted = m;
  if (masterGainNode) {
    masterGainNode.gain.value = muted ? 0 : masterVolume;
  }
}

export function isMuted(): boolean {
  return muted;
}

// Create a filter node with given parameters
function createFilter(ctx: AudioContext, params: FilterParameters): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = params.type;
  filter.frequency.value = params.frequency;
  if (params.Q !== undefined) filter.Q.value = params.Q;
  if (params.gain !== undefined) filter.gain.value = params.gain;
  return filter;
}

// Create a waveshaper distortion node
function createDistortion(ctx: AudioContext, amount: number): WaveShaperNode {
  const distortion = ctx.createWaveShaper();
  const samples = 44100;
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;
  const k = amount * 100;

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }

  distortion.curve = curve;
  distortion.oversample = '4x';
  return distortion;
}

// Create a delay effect
function createDelay(
  ctx: AudioContext,
  time: number,
  feedback: number,
  mix: number,
  output: AudioNode
): { input: GainNode; cleanup: () => void } {
  const inputGain = ctx.createGain();
  const delayNode = ctx.createDelay(1);
  const feedbackGain = ctx.createGain();
  const wetGain = ctx.createGain();
  const dryGain = ctx.createGain();

  delayNode.delayTime.value = time;
  feedbackGain.gain.value = feedback;
  wetGain.gain.value = mix;
  dryGain.gain.value = 1 - mix;

  // Dry path
  inputGain.connect(dryGain);
  dryGain.connect(output);

  // Wet path with feedback
  inputGain.connect(delayNode);
  delayNode.connect(wetGain);
  delayNode.connect(feedbackGain);
  feedbackGain.connect(delayNode);
  wetGain.connect(output);

  return {
    input: inputGain,
    cleanup: () => {
      feedbackGain.gain.value = 0;
    },
  };
}

export function playTone(options: ToneParameters): void {
  if (muted) return;

  const ctx = getContext();
  const master = getMasterGain();

  // Resume context if suspended (browser autoplay policy)
  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  const {
    frequency,
    duration,
    type = 'sine',
    volume = 0.1,
    attack = 0.005,
    decay = 0.05,
    sustain = 0.7,
    release = 0,
    freqEnd,
    vibrato = 0,
    vibratoRate = 30,
    filter,
    harmonics,
    distortion,
    delay,
    pan = 0,
    pitchEnvelope,
  } = options;

  const totalDuration = duration + release;
  const oscillators: OscillatorNode[] = [];

  // Create main oscillator
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = frequency;
  if (options.detune) osc.detune.value = options.detune;
  oscillators.push(osc);

  // Create oscillator gain for mixing multiple oscillators
  const oscMixer = ctx.createGain();
  oscMixer.gain.value = harmonics ? 1 / (1 + harmonics.length) : 1;

  // Create harmonic oscillators
  if (harmonics && harmonics.length > 0) {
    harmonics.forEach((harmVolume, index) => {
      if (harmVolume > 0) {
        const harmOsc = ctx.createOscillator();
        harmOsc.type = type;
        harmOsc.frequency.value = frequency * (index + 2); // 2nd, 3rd, 4th... harmonics
        if (options.detune) harmOsc.detune.value = options.detune;

        const harmGain = ctx.createGain();
        harmGain.gain.value = harmVolume;

        harmOsc.connect(harmGain);
        harmGain.connect(oscMixer);

        harmOsc.start(ctx.currentTime);
        harmOsc.stop(ctx.currentTime + totalDuration);
        oscillators.push(harmOsc);
      }
    });
  }

  // Apply pitch envelope
  if (pitchEnvelope) {
    const startFreq = frequency * pitchEnvelope.start;
    const endFreq = frequency * pitchEnvelope.end;
    oscillators.forEach((o) => {
      const baseFreq = o.frequency.value;
      o.frequency.setValueAtTime((baseFreq / frequency) * startFreq, ctx.currentTime);
      o.frequency.linearRampToValueAtTime(
        (baseFreq / frequency) * endFreq,
        ctx.currentTime + pitchEnvelope.time
      );
    });
  } else if (freqEnd !== undefined) {
    oscillators.forEach((o) => {
      const ratio = o.frequency.value / frequency;
      o.frequency.linearRampToValueAtTime(freqEnd * ratio, ctx.currentTime + duration);
    });
  }

  // Apply vibrato to all oscillators
  if (vibrato > 0) {
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = vibratoRate;
    lfoGain.gain.value = vibrato;
    lfo.connect(lfoGain);
    oscillators.forEach((o) => {
      lfoGain.connect(o.frequency);
    });
    lfo.start(ctx.currentTime);
    lfo.stop(ctx.currentTime + totalDuration);
  }

  // Connect main oscillator to mixer
  osc.connect(oscMixer);

  // Build the signal chain
  let currentNode: AudioNode = oscMixer;

  // Add filter if specified
  if (filter) {
    const filterNode = createFilter(ctx, filter);
    currentNode.connect(filterNode);
    currentNode = filterNode;
  }

  // Add distortion if specified
  if (distortion && distortion > 0) {
    const distortionNode = createDistortion(ctx, distortion);
    currentNode.connect(distortionNode);
    currentNode = distortionNode;
  }

  // Create envelope gain
  const gain = ctx.createGain();
  currentNode.connect(gain);

  // ADSR envelope
  const sustainTime = duration - attack - decay;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + attack);
  gain.gain.linearRampToValueAtTime(volume * sustain, ctx.currentTime + attack + decay);
  if (sustainTime > 0) {
    gain.gain.setValueAtTime(volume * sustain, ctx.currentTime + attack + decay + sustainTime);
  }
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + totalDuration);

  // Add panning
  let outputNode: AudioNode = gain;
  if (pan !== 0) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    gain.connect(panner);
    outputNode = panner;
  }

  // Add delay if specified
  if (delay && delay.time > 0) {
    const delayEffect = createDelay(ctx, delay.time, delay.feedback, delay.mix, master);
    outputNode.connect(delayEffect.input);
    setTimeout(() => delayEffect.cleanup(), (totalDuration + delay.time * 5) * 1000);
  } else {
    outputNode.connect(master);
  }

  // Start and stop oscillators
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + totalDuration);
}

export function playMultiTone(tones: ToneParameters[], stagger = 0): void {
  if (muted) return;

  tones.forEach((tone, i) => {
    if (stagger > 0) {
      setTimeout(() => playTone(tone), i * stagger * 1000);
    } else {
      playTone(tone);
    }
  });
}

export function playNoiseBurst(
  duration: number,
  volume: number,
  attack: number,
  decay: number
): void {
  if (muted) return;

  const ctx = getContext();
  const master = getMasterGain();

  // Resume context if suspended
  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    const t = i / ctx.sampleRate;
    let env = volume;
    if (t < attack) {
      env = (t / attack) * volume;
    } else if (t > duration - decay) {
      env = volume * (1 - (t - (duration - decay)) / decay);
    }
    data[i] = (Math.random() * 2 - 1) * env;
  }

  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 6000;

  source.buffer = buffer;
  source.connect(filter);
  filter.connect(master);
  source.start(ctx.currentTime);
}

// Play custom sound from parameters
export function playCustomSound(
  tones: ToneParameters[],
  stagger?: number,
  noise?: { duration: number; volume: number; attack: number; decay: number }
): void {
  if (muted) return;

  playMultiTone(tones, stagger);

  if (noise) {
    playNoiseBurst(noise.duration, noise.volume, noise.attack, noise.decay);
  }
}
