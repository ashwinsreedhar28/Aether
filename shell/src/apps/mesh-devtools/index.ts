import type { AppDefinition } from '../../lib/app-definition'
import { MeshDevTools } from './MeshDevTools'

export const app: AppDefinition = {
  id: 'mesh-devtools',
  name: 'Mesh',
  icon: 'Cable',
  component: MeshDevTools,
  // Slots between News (50) and any future apps. Order keys are spaced in
  // 50-unit increments per CLAUDE.md §11 #6 so later apps can insert without
  // renumbering.
  order: 90
}
