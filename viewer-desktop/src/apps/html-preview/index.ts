import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const HtmlPreviewApp = createLazyApp(() => import('./HtmlPreview').then(m => ({ default: m.HtmlPreview })));

export const app: AppDefinition = {
  id: 'html-preview',
  name: 'HTML Preview',
  icon: 'Globe',
  fileTypes: ['html', 'htm'],
  component: HtmlPreviewApp,
  defaultSize: { width: 900, height: 700 },
};
