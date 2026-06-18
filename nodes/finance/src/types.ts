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

  // ── Optional enrichment (issue #354) ──
  // The first two are filled by the surface handler from the git-resident
  // ticker catalog (tickers.ts), not the upstream feed — they let the app
  // group + label without a second round-trip.
  /** Display name from the catalog, e.g. "NVIDIA Corporation". */
  name?: string
  /** Curated sector tag from the catalog (app grouping). */
  sector?: string
  // The rest come free on Yahoo's quote() response; absent on the Stooq
  // fallback path and so all optional. The detail page renders whatever
  // is present (basic stats: P/E, market cap, day range, 52-week range).
  /** Session open price. */
  open?: number
  /** Intraday high. */
  day_high?: number
  /** Intraday low. */
  day_low?: number
  /** Trailing twelve-month P/E ratio. */
  pe_ratio?: number
  /** Market capitalisation, in the quote currency. */
  market_cap?: number
  /** Trailing 52-week high. */
  fifty_two_week_high?: number
  /** Trailing 52-week low. */
  fifty_two_week_low?: number
}

// finance.chart spans. Distinct from finance.history's passive-accumulation
// periods (1d/1w/1m/all): these are fetched live from Yahoo's chart endpoint
// (see client.fetchChart + DECISIONS "finance.chart upstream fetch for the
// detail page"). Ordered shortest → longest so the schema enum, this set,
// and the app's span toggle share one reading order.
export type ChartRange = '1D' | '5D' | '1M' | '3M' | '1Y'
export const CHART_RANGES: ChartRange[] = ['1D', '5D', '1M', '3M', '1Y']

// One point on a fetched chart. Narrow on purpose — the renderer's line
// chart only needs a timestamp + close. `close` is the plotted value;
// `volume` rides along for an optional volume strip.
export interface ChartPoint {
  /** Full ISO 8601 timestamp for the bar. */
  t: string
  close: number
  volume: number
}
