import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const KnowledgeGraphComponent = createLazyApp(() =>
  import('./KnowledgeGraph').then((m) => ({ default: m.KnowledgeGraph }))
);

export const app: AppDefinition = {
  id: 'knowledge-graph',
  name: 'Knowledge Graph',
  icon: 'Network',
  fileTypes: ['mindmap'],
  component: KnowledgeGraphComponent,
  defaultSize: { width: 1200, height: 800 },
};
