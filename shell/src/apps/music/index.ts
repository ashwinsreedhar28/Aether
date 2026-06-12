import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const MusicApp = createLazyApp(() => import('./MusicApp').then((m) => ({ default: m.MusicApp })));

export const app: AppDefinition = {
  id: 'music',
  name: 'Music',
  icon: 'Music',
  component: MusicApp,
  defaultSize: { width: 420, height: 580 },
};
