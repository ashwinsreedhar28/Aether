import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const MarkdownEditorApp = createLazyApp(() => import('./MarkdownEditor').then(m => ({ default: m.MarkdownEditor })));

export const app: AppDefinition = {
  id: 'markdown-viewer',  // Keep old ID for backwards compatibility
  name: 'Markdown Editor',
  icon: 'FileText',
  fileTypes: ['md', 'markdown'],
  component: MarkdownEditorApp,
  defaultSize: { width: 900, height: 700 },
};
