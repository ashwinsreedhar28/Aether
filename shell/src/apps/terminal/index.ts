import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const TerminalApp = createLazyApp(() => import('./Terminal').then(m => ({ default: m.Terminal })));

export const app: AppDefinition = {
  id: 'terminal',
  name: 'Terminal',
  icon: 'Terminal',
  // Terminal doesn't handle file types
  component: TerminalApp,
  defaultSize: { width: 800, height: 500 },
};
