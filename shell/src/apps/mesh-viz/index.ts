import type { AppDefinition } from '../../lib/app-definition'
import { MeshViz } from './MeshViz'

export const app: AppDefinition = {
  id: 'mesh-viz',
  name: 'Mesh',
  icon: 'Network',
  component: MeshViz,
  // 100: the second mesh-introspection surface, grouped right after
  // mesh-devtools (90). Next gap-spaced slot per CLAUDE.md §11 #6.
  order: 100
}
