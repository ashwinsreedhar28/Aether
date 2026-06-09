/**
 * Sound Engine
 * Central singleton for managing all sound playback in the viewer.
 */

import type { ViewerEvent, SoundDefinition, SoundSystemConfig, EventBinding } from './types';
import { initAudio, setMasterVolume, getMasterVolume, setMuted, isMuted, playCustomSound } from './synthesis';
import { presetDefinitions, playPreset } from './presetSounds';
import { getDefaultBindings } from './defaultBindings';

class SoundEngine {
  private eventBindings: Map<ViewerEvent, EventBinding> = new Map();
  private customSounds: Map<string, SoundDefinition> = new Map();
  private initialized = false;

  constructor() {
    // Load default bindings
    this.loadDefaultBindings();
  }

  private loadDefaultBindings(): void {
    const defaults = getDefaultBindings();
    defaults.forEach((binding) => {
      this.eventBindings.set(binding.event, binding);
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await initAudio();
    this.initialized = true;
  }

  // Volume controls
  setMasterVolume(volume: number): void {
    setMasterVolume(volume);
  }

  getMasterVolume(): number {
    return getMasterVolume();
  }

  setMuted(muted: boolean): void {
    setMuted(muted);
  }

  isMuted(): boolean {
    return isMuted();
  }

  // Event playback
  playEvent(event: ViewerEvent): void {
    const binding = this.eventBindings.get(event);
    if (!binding || !binding.enabled) return;

    this.playSound(binding.soundId);
  }

  // Sound playback
  playSound(soundId: string): void {
    // First check if it's a custom sound
    const custom = this.customSounds.get(soundId);
    if (custom && custom.parameters) {
      playCustomSound(custom.parameters, custom.stagger, custom.includeNoise);
      return;
    }

    // Otherwise play preset
    playPreset(soundId);
  }

  // Event binding management
  setEventBinding(event: ViewerEvent, soundId: string, enabled = true): void {
    this.eventBindings.set(event, { event, soundId, enabled });
  }

  setEventEnabled(event: ViewerEvent, enabled: boolean): void {
    const binding = this.eventBindings.get(event);
    if (binding) {
      binding.enabled = enabled;
    }
  }

  getEventBinding(event: ViewerEvent): EventBinding | undefined {
    return this.eventBindings.get(event);
  }

  getAllBindings(): EventBinding[] {
    return Array.from(this.eventBindings.values());
  }

  // Custom sound management
  addCustomSound(sound: SoundDefinition): void {
    this.customSounds.set(sound.id, sound);
  }

  removeCustomSound(id: string): void {
    this.customSounds.delete(id);
  }

  getCustomSound(id: string): SoundDefinition | undefined {
    return this.customSounds.get(id);
  }

  getCustomSounds(): SoundDefinition[] {
    return Array.from(this.customSounds.values());
  }

  // Get all available sounds (presets + custom)
  getAllSounds(): SoundDefinition[] {
    return [...presetDefinitions, ...this.getCustomSounds()];
  }

  getPresetSounds(): SoundDefinition[] {
    return presetDefinitions;
  }

  // Persistence
  loadConfig(config: SoundSystemConfig): void {
    // Apply volume settings
    this.setMasterVolume(config.masterVolume);
    this.setMuted(config.muted);

    // Load event bindings
    this.eventBindings.clear();
    config.eventBindings.forEach((binding) => {
      this.eventBindings.set(binding.event, binding);
    });

    // Load custom sounds
    this.customSounds.clear();
    config.customSounds.forEach((sound) => {
      this.customSounds.set(sound.id, sound);
    });
  }

  exportConfig(): SoundSystemConfig {
    return {
      version: 1,
      masterVolume: this.getMasterVolume(),
      muted: this.isMuted(),
      eventBindings: this.getAllBindings(),
      customSounds: this.getCustomSounds(),
    };
  }

  // Reset to defaults
  resetToDefaults(): void {
    this.eventBindings.clear();
    this.loadDefaultBindings();
    this.customSounds.clear();
    this.setMasterVolume(0.5);
    this.setMuted(false);
  }
}

// Export singleton instance
export const soundEngine = new SoundEngine();

// Export for direct access if needed
export { SoundEngine };
