/**
 * Dependency Graph App Registration
 */

import type { AppDefinition } from '../types';
import { DependencyGraph } from './DependencyGraph';

export const app: AppDefinition = {
  id: 'dependency-graph',
  name: 'Dependency Graph',
  icon: 'GitBranch',
  component: DependencyGraph,
  defaultSize: { width: 900, height: 650 },
};
