import type { ComponentType } from 'react'

// Shape adopted from _ingest/VIEWER/apps/viewer/src/apps/types.ts, simplified:
//
// - No `fileTypes` — week 1 has no file-based apps. Coming back when the
//   first one (markdown editor, JSON viewer, …) lands.
// - No `AppProps` on the component — single-window, no per-instance
//   props yet. Components are zero-arg.
// - `defaultSize` kept as forward-looking placeholder; unused today, will
//   matter when multi-window arrives.
export interface AppDefinition {
  id: string
  name: string
  icon: string
  component: ComponentType
  /** Sort key for nav. Lower = earlier. Default = 100. */
  order?: number
  defaultSize?: { width: number; height: number }
}
