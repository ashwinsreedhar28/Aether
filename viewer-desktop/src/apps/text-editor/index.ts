import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const TextEditorApp = createLazyApp(() => import('./TextEditor').then(m => ({ default: m.TextEditor })));

export const app: AppDefinition = {
  id: 'text-viewer',  // Keep old ID for backwards compatibility
  name: 'Text Editor',
  icon: 'FileCode',
  // text-viewer is the default for unknown file types, so no fileTypes needed
  // but we can specify some common ones
  fileTypes: ['txt', 'log', 'cfg', 'ini', 'env', 'gitignore', 'yml', 'yaml', 'toml', 'xml', 'html', 'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'c', 'cpp', 'h', 'sh', 'bash', 'zsh'],
  component: TextEditorApp,
  defaultSize: { width: 800, height: 600 },
};
