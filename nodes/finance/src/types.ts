// Canonical Quote shape. Mirrored in nodes/finance/schemas/*.json (the
// surface schemas validate inputs, not outputs — Core does not validate
// response payloads — but a single source of truth here keeps the
// renderer and voice consumers in step). Numeric fields are pre-parsed
// from the upstream API so consumers don't reparse strings every render.
//
// Volume is back in v0.3.x: Yahoo Finance returns it on the same /quote
// call as price + change. Stooq returns it too (fallback path). The
// voice tool's _strip_quote intentionally drops volume from spoken
// readbacks — "Apple is at 189, down a percent, on 40 million shares"
// is noise — but the renderer's QuoteCard shows it.
export interface Quote {
  symbol: string
  price: number
  change: number
  change_percent: number
  /** Day volume in shares. 0 when the upstream omitted it (rare). */
  volume: number
  /** ISO date (YYYY-MM-DD) derived from the upstream timestamp. */
  latest_trading_day: string
  /** Full ISO 8601 timestamp at which this node last fetched the quote. */
  fetched_at: string
}
