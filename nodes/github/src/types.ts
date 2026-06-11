// Wire types for the github Actor node. These shapes ARE the surface contract
// documented in README.md — Lane B (the Gaps panel) and Lane C (raven's gap
// filing) build against them. Change with the same care as a schema file.

/** One open issue as served by github.list_issues. No body — the panel
 *  renders the board, not issue content; click-through goes to `url`. */
export interface IssueSummary {
  number: number
  title: string
  labels: string[]
  state: 'open'
  /** ISO 8601 — the panel derives "age" from this. */
  created_at: string
  updated_at: string
  /** Comment count — the +1 demand signal on a deduped gap. */
  comments: number
  /** html_url — the click-through target. */
  url: string
  author: string | null
}

/** As above plus the raw markdown body — dedup extracts the capability-key
 *  marker from it. Internal to the node; never served over the mesh. */
export interface RawIssue extends IssueSummary {
  body: string | null
}

/** github.list_issues response payload (mirrors lanes.status shape:
 *  data + fetched_at_ms + stale + availability flag). */
export interface ListIssuesPayload {
  issues: IssueSummary[]
  /** 0 when nothing has ever been fetched (degraded no-token mode). */
  fetched_at_ms: number
  /** true when GitHub was unreachable and this is the last good fetch. */
  stale: boolean
  /** false ⇔ AETHER_GITHUB_TOKEN absent — the clean no-token state. */
  token_available: boolean
}
