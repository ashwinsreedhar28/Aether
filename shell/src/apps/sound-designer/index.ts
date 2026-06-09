import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const SoundDesignerApp = createLazyApp(() => import('./SoundDesigner').then(m => ({ default: m.SoundDesigner })));

export const app: AppDefinition = {
  id: 'sound-designer',
  name: 'Sound Designer',
  icon: 'AudioWaveform',
  component: SoundDesignerApp,
  defaultSize: { width: 650, height: 550 },
};
