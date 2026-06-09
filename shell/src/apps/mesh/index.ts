import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const MeshApp = createLazyApp(() => import('./MeshApp').then((m) => ({ default: m.MeshApp })));

export const app: AppDefinition = {
  id: 'mesh',
  name: 'Mesh',
  icon: 'Network',
  component: MeshApp,
  defaultSize: { width: 640, height: 620 },
};
