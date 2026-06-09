import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const KeyboardShortcutsApp = createLazyApp(() =>
  import('./KeyboardShortcuts').then((m) => ({ default: m.KeyboardShortcuts }))
);

export const app: AppDefinition = {
  id: 'keyboard-shortcuts',
  name: 'Keyboard Shortcuts',
  icon: 'Keyboard',
  component: KeyboardShortcutsApp,
  defaultSize: { width: 720, height: 640 },
};
