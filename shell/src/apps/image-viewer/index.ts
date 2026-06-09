import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const ImageViewerApp = createLazyApp(() => import('./ImageViewer').then(m => ({ default: m.ImageViewer })));

export const app: AppDefinition = {
  id: 'image-viewer',
  name: 'Image Viewer',
  icon: 'Image',
  fileTypes: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'],
  component: ImageViewerApp,
  defaultSize: { width: 800, height: 600 },
};
