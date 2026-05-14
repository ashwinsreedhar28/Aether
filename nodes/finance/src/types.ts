// Canonical Quote shape. Mirrored in nodes/finance/schemas/*.json (the
// surface schemas validate inputs, not outputs — Core does not validate
// response payloads — but a single source of truth here keeps the
// renderer and voice consumers in step). Numeric fields are pre-parsed
// from the upstream API so consumers don't reparse strings every render.
//
// Volume is intentionally not part of v1. Finnhub's /quote endpoint
// (the upstream we use) does not return volume; fetching it requires a
// separate /stock/metric call that would double request volume against
// the rate limit. Re-add when there's a use case worth the extra hop —
// see DECISIONS.md "Second data node: finance via Finnhub" for the
// trade-off.
export interface Quote {
  symbol: string
  price: number
  change: number
  change_percent: number
  /** ISO date (YYYY-MM-DD) derived from the upstream timestamp. */
  latest_trading_day: string
  /** Full ISO 8601 timestamp at which this node last fetched the quote. */
  fetched_at: string
}
