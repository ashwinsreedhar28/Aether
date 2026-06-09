import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const JsonViewerApp = createLazyApp(() => import('./JsonViewer').then(m => ({ default: m.JsonViewer })));

export const app: AppDefinition = {
  id: 'json-viewer',
  name: 'JSON Viewer',
  icon: 'Braces',
  fileTypes: ['json'],
  component: JsonViewerApp,
  defaultSize: { width: 800, height: 600 },
};
