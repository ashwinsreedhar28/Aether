import type { ComponentType } from 'react'

// Shape adopted from _ingest/VIEWER/apps/viewer/src/apps/types.ts, simplified.
//
// Apps fall into two shapes:
// - **Standalone** apps (no `fileTypes`): rendered when their nav button is
//   clicked; the component sources its own content. Welcome, News, future
//   Mesh devtools fit here.
// - **File-based** apps (with `fileTypes`): can be the renderer for files
//   whose lowercase extension matches any entry. Markdown is the first.
//   The `getAppsForFileType` helper in app-registry is the routing hook —
//   no consumer wires it yet (no file explorer / drop target exists), but
//   declaring `fileTypes` today makes the eventual wiring a no-op for the
//   app author.
//
// Component is still zero-arg in either shape — single-window, no
// per-instance props. File-based apps source the current path from their
// own internal state (e.g. via a header bar's "Open" button) rather than
// receiving it as a prop, until multi-window arrives.
export interface AppDefinition {
  id: string
  name: string
  icon: string
  component: ComponentType
  /** Sort key for nav. Lower = earlier. Default = 100. */
  order?: number
  /**
   * Lowercase file extensions (without leading dot) this app can render,
   * e.g. `['md', 'markdown']`. Apps without this field are standalone.
   * Matching is case-insensitive — the registry lowercases incoming
   * extensions before lookup.
   */
  fileTypes?: string[]
  /**
   * Optional override of `icon` for a specific file path — e.g. a JSON
   * viewer that picks a different lucide glyph for `package.json`. Future
   * use; no consumer reads this yet. Apps declaring `fileTypes` may
   * provide it now to avoid a follow-up PR when the file-router lands.
   */
  iconForFile?: (path: string) => string
  defaultSize?: { width: number; height: number }
}
