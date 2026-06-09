import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const PdfViewerApp = createLazyApp(() => import('./PdfViewer').then(m => ({ default: m.PdfViewer })));

export const app: AppDefinition = {
  id: 'pdf-viewer',
  name: 'PDF Viewer',
  icon: 'FileText',
  fileTypes: ['pdf'],
  component: PdfViewerApp,
  defaultSize: { width: 900, height: 700 },
};
