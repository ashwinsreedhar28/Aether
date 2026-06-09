import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const AudioPlayerApp = createLazyApp(() => import('./AudioPlayer').then(m => ({ default: m.AudioPlayer })));

export const app: AppDefinition = {
  id: 'audio-player',
  name: 'Audio Player',
  icon: 'Music',
  fileTypes: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'],
  component: AudioPlayerApp,
  defaultSize: { width: 600, height: 220 },
};
