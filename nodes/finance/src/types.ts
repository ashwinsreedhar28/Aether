// Canonical Quote shape. Mirrored in nodes/finance/schemas/*.json (the
// surface schemas validate inputs, not outputs — Core does not validate
// response payloads — but a single source of truth here keeps the
// renderer and voice consumers in step). Numeric fields are pre-parsed
// from the upstream API strings so consumers don't reparse "1234.56"
// every render.
export interface Quote {
  symbol: string
  price: number
  change: number
  change_percent: number
  volume: number
  /** ISO date (YYYY-MM-DD). The latest trading day the upstream API reports. */
  latest_trading_day: string
  /** Full ISO 8601 timestamp at which this node last fetched the quote. */
  fetched_at: string
}
