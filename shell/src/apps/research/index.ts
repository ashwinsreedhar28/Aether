import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const ResearchApp = createLazyApp(() =>
  import('./ResearchApp').then((m) => ({ default: m.ResearchApp })),
);

export const app: AppDefinition = {
  id: 'research',
  name: 'Research',
  icon: 'BookOpen',
  component: ResearchApp,
  defaultSize: { width: 560, height: 700 },
};
