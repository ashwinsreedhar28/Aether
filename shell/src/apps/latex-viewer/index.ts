import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const LatexViewerApp = createLazyApp(() => import('./LatexViewer').then(m => ({ default: m.LatexViewer })));

export const app: AppDefinition = {
  id: 'latex-viewer',
  name: 'LaTeX Viewer',
  icon: 'FileType',
  fileTypes: ['tex', 'latex'],
  component: LatexViewerApp,
  defaultSize: { width: 900, height: 700 },
};
