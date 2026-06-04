import { ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { sceneOrderPath } from '../services/paths'

// Persisted Scene arrangement. The user drags Scene panels into an order; we
// store the exact panel-id sequence so it survives restarts. The file is the
// single source of saved order — its absence means "no saved order," and the
// Scene falls back to server arrival order. Shape on disk: { order: string[] }.
//
// Pattern lifted from handlers/files.ts: one registrar exported and called from
// main/index.ts at app-ready. Kept deliberately tiny — read one JSON, write one
// JSON, never throw across the IPC boundary.
interface SceneOrderFile {
  order: string[]
}

// Coerce arbitrary parsed JSON into a clean id list: strings only, de-duped,
// non-empty. A hand-edited or partially-written file must not be able to wedge
// the view, so anything that doesn't look like an id is dropped.
function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of value) {
    if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

export function registerSceneOrderHandlers(): void {
  // Read the saved order. Missing file / unreadable / malformed all degrade to
  // an empty order, so the Scene renders in arrival order instead of erroring.
  ipcMain.handle('scene:get-order', async () => {
    try {
      const raw = await fs.readFile(sceneOrderPath(), 'utf-8')
      const parsed = JSON.parse(raw) as Partial<SceneOrderFile>
      return { order: cleanIds(parsed?.order) }
    } catch {
      return { order: [] }
    }
  })

  // Persist a new order (array of panel ids in display order). Written
  // atomically (tmp + rename) so a crash mid-write can't leave a truncated JSON
  // that the next boot would choke on. The top-level userData dir always
  // exists, so no mkdir is needed.
  ipcMain.handle('scene:set-order', async (_e, order: unknown) => {
    const clean = cleanIds(order)
    const path = sceneOrderPath()
    const tmp = `${path}.tmp`
    const body = JSON.stringify({ order: clean } satisfies SceneOrderFile)
    try {
      await fs.writeFile(tmp, body, 'utf-8')
      await fs.rename(tmp, path)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}
