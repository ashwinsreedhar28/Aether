import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const GapsApp = createLazyApp(() => import('./GapsApp').then((m) => ({ default: m.GapsApp })));

export const app: AppDefinition = {
  id: 'gaps',
  name: 'Gaps',
  icon: 'CircleDashed',
  component: GapsApp,
  defaultSize: { width: 520, height: 600 },
};
