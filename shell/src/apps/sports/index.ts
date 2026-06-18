import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const SportsApp = createLazyApp(() => import('./SportsApp').then((m) => ({ default: m.SportsApp })));

export const app: AppDefinition = {
  id: 'sports',
  name: 'Sports',
  icon: 'Trophy',
  component: SportsApp,
  defaultSize: { width: 520, height: 640 },
};
