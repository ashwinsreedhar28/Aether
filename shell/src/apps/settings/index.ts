import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const SettingsApp = createLazyApp(() => import('./Settings').then(m => ({ default: m.Settings })));

export const app: AppDefinition = {
  id: 'settings',
  name: 'Settings',
  icon: 'Settings',
  component: SettingsApp,
  defaultSize: { width: 700, height: 550 },
};
