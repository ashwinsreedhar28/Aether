import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const MermaidViewerApp = createLazyApp(() => import('./MermaidViewer').then(m => ({ default: m.MermaidViewer })));

export const app: AppDefinition = {
  id: 'mermaid-viewer',
  name: 'Mermaid Viewer',
  icon: 'GitBranch',
  fileTypes: ['mmd', 'mermaid'],
  component: MermaidViewerApp,
  defaultSize: { width: 900, height: 700 },
};
