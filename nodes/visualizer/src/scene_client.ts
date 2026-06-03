import type { ScenePanel } from './types'

// HTTP bridge from the visualizer (mesh) to the RAVEN_AVP scene server
// (presentation). This is the "mesh in, HTTP out" half of the node: the render
// surface reads mesh state via node.invoke(), composes panels, and ships them
// here. Per the data-layer/presentation-layer ADR, the visualizer is the ONLY
// mesh component that POSTs to the scene server.
//
// Every method is failure-tolerant: a down scene server yields { ok: false }
// rather than a thrown error, so the node's dashboard poll loop can log + skip
// the cycle and retry on the next tick instead of crashing.

export interface SceneResult {
  ok: boolean
  status?: number
  error?: string
}

const POST_TIMEOUT_MS = 5_000

// CRITICAL (governance-log 2026-05-26): the Swift AVP client decodes a panel's
// `style` as `[String: String]?`. A non-string value (number, bool, null)
// silently kills the entire SceneMessage decode — the frame drops with no
// client-side error and the shell simply doesn't render. coerceStyle is the
// single choke point through which every panel passes before POST, so it is
// impossible to ship a non-string style value. Numbers become "14", booleans
// become "true"/"false", null/undefined are dropped.
export function coerceStyle(style: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!style) return out
  for (const [key, value] of Object.entries(style)) {
    if (value === null || value === undefined) continue
    out[key] = typeof value === 'string' ? value : String(value)
  }
  return out
}

export class SceneClient {
  private readonly baseUrl: string
  private readonly log: (msg: string) => void

  constructor(baseUrl: string, log: (msg: string) => void) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.log = log
  }

  // Append a brand-new panel. POST /scene/panel — the scene server 409s if a
  // panel with this id already exists (post_panel_add in main.py).
  async postPanel(panel: ScenePanel): Promise<SceneResult> {
    return this.send('POST', '/scene/panel', panel)
  }

  // Merge a panel in place. POST /scene/panel/{id} — the scene server applies a
  // partial update to the existing panel (post_panel_merge in main.py) and 404s
  // if no panel with this id exists yet.
  async mergePanel(panel: ScenePanel): Promise<SceneResult> {
    return this.send('POST', `/scene/panel/${encodeURIComponent(panel.id)}`, panel)
  }

  // Idempotent create-or-update. Tries MERGE first (so re-POSTs of stable ids —
  // dashboard.* backdrops, the viz-mesh overlay — never 409); on a 404 (panel
  // doesn't exist yet, e.g. first boot with a fresh scene_state.json) falls
  // back to APPEND to create it. This satisfies the lane constraint "dashboard
  // re-POSTs must use the merge endpoint to avoid 409 storms" while still
  // seeding panels that don't exist yet.
  async upsertPanel(panel: ScenePanel): Promise<SceneResult> {
    const merged = await this.mergePanel(panel)
    if (merged.ok) return merged
    if (merged.status === 404) {
      return this.postPanel(panel)
    }
    return merged
  }

  private async send(method: string, path: string, panel: ScenePanel): Promise<SceneResult> {
    // Coerce style at the wire boundary — see coerceStyle's governance note.
    const body = { ...panel, style: coerceStyle(panel.style) }
    try {
      const resp = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      })
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        return { ok: false, status: resp.status, error: text }
      }
      return { ok: true, status: resp.status }
    } catch (err) {
      // Scene server unreachable / timed out. Caller logs + skips the cycle.
      return { ok: false, error: String(err) }
    }
  }
}
