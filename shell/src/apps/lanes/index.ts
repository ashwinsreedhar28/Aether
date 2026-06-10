import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const LanesApp = createLazyApp(() => import('./LanesApp').then((m) => ({ default: m.LanesApp })));

export const app: AppDefinition = {
  id: 'lanes',
  name: 'Lanes',
  icon: 'GitBranch',
  component: LanesApp,
  defaultSize: { width: 560, height: 520 },
};
