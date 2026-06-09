import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const KanbanBoardApp = createLazyApp(() => import('./KanbanBoard').then(m => ({ default: m.KanbanBoard })));

export const app: AppDefinition = {
  id: 'kanban-board',
  name: 'Kanban',
  icon: 'LayoutDashboard',
  component: KanbanBoardApp,
  fileTypes: ['kanban'],
  defaultSize: { width: 1100, height: 680 },
};
