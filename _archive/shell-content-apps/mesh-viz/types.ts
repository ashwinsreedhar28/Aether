// Renderer-side mirror of the mesh_introspection node's payload shapes.
//
// Deliberately duplicated rather than imported from @aether/mesh-introspection:
// the renderer bundle and the Node bundle are different runtimes, and pulling
// the node package into the renderer would drag Node-only code paths into the
// browser build. Same rationale as the news/Article and finance/Quote
// duplications. The shapes below are the broker payloads locked by the #109/
// #110/#111/#112 substrate and verified end-to-end by Director smoke; keep them
// in sync with nodes/mesh_introspection/src/types.ts if the wire changes.

/** Manifest-declared node category. Capitalized — the locked manifest value. */
export type NodeCategory = 'Sensor' | 'Actor' | 'Mixer' | 'Planner'

/** Node liveness as reported by the broker's node registry. */
export type NodeStatus = 'running' | 'unhealthy' | 'stopped'

export interface TopologyNode {
  id: string
  category: NodeCategory
  /** Surface names exposed by this node (just names, not objects). */
  surfaces: string[]
  /** Unix seconds of last heartbeat, or null if never seen. */
  last_seen_ts: number | null
  status: NodeStatus
}

/**
 * One permitted invocation route. Edges are PER-SURFACE: two nodes can have
 * several edges between them, one per allowed surface call. `allowed` is the
 * forward-compat field from #110 — the manifest edge graph is permitted by
 * construction, so this is true for every edge the broker currently returns.
 */
export interface TopologyEdge {
  from: string
  to: string
  surface: string
  allowed: boolean
}

export interface TopologyPayload {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  /** Broker clock, ms. */
  fetched_at_ms: number
  /** Set by the broker when the cached snapshot is >10s old. */
  stale?: boolean
}

/** One recorded invocation from the broker's ring buffer. */
export interface ActivityEntry {
  /** Unix seconds. */
  ts: number
  src_node: string
  dst_node: string
  surface: string
  success: boolean
  /** null on success; an error tag (e.g. 'broker_timeout') on failure. */
  error_kind: string | null
  latency_ms: number
}

export interface ActivityPayload {
  /** Newest-first — guaranteed by the broker. Do NOT re-sort. */
  activity: ActivityEntry[]
  fetched_at_ms: number
  stale?: boolean
}

/**
 * The built-in broker node renders at the center of the radial layout. The
 * broker reports it with status "stopped" (Core does not heartbeat with
 * itself), so the viz treats it as a special "dispatch host" rather than a
 * categorized node. See PR Open Questions.
 */
export const CORE_NODE_ID = 'core'
