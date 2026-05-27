// Types mirror the broker's /__introspection__ response shape locked in
// PRs #109 + #110. Kept as `unknown`-tolerant shapes (any extra fields
// the broker adds in future versions pass through untouched).

export interface BrokerNode {
  id: string
  category: string
  description: string // NEW — empty string if not set in manifest
  surfaces: string[]
  last_seen_ts: number | null
  status: string
}

export interface BrokerEdge {
  from: string
  to: string
  surface: string
  allowed: boolean
}

export interface BrokerActivity {
  ts: number
  src_node: string
  dst_node: string
  surface: string
  success: boolean
  error_kind: string | null
  latency_ms: number
}

export interface BrokerIntrospection {
  nodes: BrokerNode[]
  edges: BrokerEdge[]
  activity: BrokerActivity[]
}

export type FetchErrorKind =
  | 'broker_unreachable'
  | 'broker_unauthorized'
  | 'broker_timeout'

export type FetchResult =
  | { ok: true; data: BrokerIntrospection }
  | { ok: false; kind: FetchErrorKind }
