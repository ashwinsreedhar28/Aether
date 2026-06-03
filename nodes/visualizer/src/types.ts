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
