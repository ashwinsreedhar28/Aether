import type { AppDefinition } from '../types';
import { createLazyApp } from '../AppWrapper';

const McpInspectorApp = createLazyApp(() =>
  import('./McpInspector').then(m => ({ default: m.McpInspector }))
);

export const app: AppDefinition = {
  id: 'mcp-inspector',
  name: 'MCP Inspector',
  icon: 'Activity',
  component: McpInspectorApp,
  defaultSize: { width: 1000, height: 700 },
};
