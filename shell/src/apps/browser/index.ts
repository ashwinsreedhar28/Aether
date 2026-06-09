import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const BrowserApp = createLazyApp(() => import('./Browser').then(m => ({ default: m.Browser })));

export const app: AppDefinition = {
  id: 'browser',
  name: 'Browser',
  icon: 'Globe',
  component: BrowserApp,
  defaultSize: { width: 1024, height: 768 },
};
