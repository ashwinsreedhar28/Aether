// Local types for the visualizer node. Two contracts meet here:
//
//   1. The INBOUND mesh data — the payload returned by
//      `mesh_introspection.topology` (see nodes/mesh_introspection/src/types.ts
//      BrokerIntrospection). Kept `unknown`-tolerant: extra fields the broker
//      adds in future pass through untouched, and missing fields are handled
//      defensively in templates.ts.
//
//   2. The OUTBOUND presentation — the RAVEN_AVP SceneDoc `Panel` shape we POST
//      to the scene server (daemons/raven-avp-server/server/scene_doc.py
//      `Panel`). `transform` + `size` are REQUIRED by the server's Pydantic
//      model even though the 2D macOS dashboard ignores position (layout is
//      arrival-order column, Sprint 6.3b Q3=C); they exist for the 3D AVP shell.

// ── Inbound: mesh topology (mesh_introspection.topology payload) ──────────────

export interface MeshNodeInfo {
  id: string
  category: string
  description: string
  surfaces: string[]
  last_seen_ts: number | null
  status: string
}

export interface MeshEdgeInfo {
  from: string
  to: string
  surface: string
  allowed: boolean
}

export interface Topology {
  nodes: MeshNodeInfo[]
  edges: MeshEdgeInfo[]
  // Set by mesh_introspection when its last successful broker fetch is >10s old.
  stale?: boolean
  fetched_at_ms?: number
}

// ── Inbound: lanes status (lanes.status payload) ──────────────────────────────

// One development lane = one git worktree of the shared repo. Mirrors the lanes
// sensor's Lane shape (nodes/lanes/src/types.ts); `unknown`-tolerant like the
// topology types above.
export interface LaneInfo {
  name: string
  branch: string
  is_main: boolean
  dirty_count: number
  last_commit_ms: number | null
  last_activity_ms: number
  state: string // 'active' | 'idle'
}

export interface LanesStatus {
  lanes: LaneInfo[]
  stale?: boolean
  fetched_at_ms?: number
}

// ── Inbound: gap records (intents.list payload) ───────────────────────────────

// One recorded capability gap — a thing Aether could not do. Mirrors the gap
// sensor's GapRecord shape (nodes/intents/src/storage.ts): `ts` is an ISO 8601
// UTC timestamp, `context` a string or null, `status` 'open' | 'closed'.
// `unknown`-tolerant like the topology/lanes types above.
export interface GapRecord {
  id: string
  ts: string
  text: string
  context: string | null
  status: string // 'open' | 'closed'
}

// intents.list returns gaps newest-first (the store walks its append-only log
// bottom-up), so the template renders them in array order — no client sort.
// `counts` reflects the WHOLE log (open + closed) regardless of the status
// filter, so the panel header can read "N open · M closed" while the body shows
// only open gaps. Optional for tolerance against an older intents node.
export interface GapsResult {
  gaps: GapRecord[]
  counts?: { open: number; closed: number }
}

// ── Inbound: calendar events (calendar.today / calendar.upcoming payload) ──────

// One calendar event. Mirrors the calendar node's format_event shape
// (nodes/calendar/main.py): `start` / `end` are LOCAL naive ISO 8601 strings —
// the node uses datetime.fromtimestamp(...).isoformat(), which emits the host's
// system-local wall-clock with NO timezone offset (e.g. "2026-06-05T10:00:00").
// The template reads those wall-clock components LITERALLY (parseLocalIso in
// templates.ts) and never feeds them to `new Date()`: an offset-less stamp lets
// the JS engine guess a zone (UTC vs local varies by engine and by how the
// daemon is spawned), which silently shifts the rendered time. `unknown`-tolerant
// like the types above.
export interface CalendarEvent {
  title: string
  start: string
  end: string
  location: string
  calendar_name: string
  is_all_day: boolean
  notes: string
}

// Raw payload from a calendar surface. The node returns either
// { available: true, events } or a NORMAL { available: false, reason } —
// reason is one of 'no_events' | 'permission_denied' | 'framework_unavailable'.
// Both shapes arrive as ordinary response envelopes (not mesh errors), so the
// template inspects `available` / `reason` to decide what to render.
export interface CalendarResult {
  available: boolean
  events?: CalendarEvent[]
  reason?: string
}

// Composed input to the agenda template: today's full day plus the upcoming
// window the template carves "tomorrow" out of. Either side is null when its
// surface read threw (mesh/edge failure) — distinct from an available:false
// reason carried inside a CalendarResult.
export interface AgendaData {
  today: CalendarResult | null
  upcoming: CalendarResult | null
}

// ── Outbound: scene-server panel ──────────────────────────────────────────────

export interface Transform {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
}

export interface Size {
  width: number
  height: number
}

export type PanelKind = 'text' | 'markdown'

export interface ScenePanel {
  id: string
  kind: PanelKind
  text: string
  transform: Transform
  size: Size
  // CRITICAL: every value must be a string before POST — the Swift AVP client
  // decodes `style` as `[String: String]?` and a non-string value silently
  // kills the entire SceneMessage decode (governance-log 2026-05-26). The scene
  // client's coerceStyle() enforces this at POST time.
  style: Record<string, string>
}

// ── render surface return contract ────────────────────────────────────────────

// The visualizer.render surface returns this (roadmap Sprint 6.4 surface
// contract). `unknown_intent` is the one case that instead throws MeshDeny —
// a request-level rejection rather than a downstream failure.
export type RenderResult =
  | { ok: true; intent: string; panels: number }
  | { ok: false; intent: string; error: string }
