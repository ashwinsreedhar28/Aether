import type { Quote } from './types'

// Thin Finnhub /quote client. Endpoint documented at
// https://finnhub.io/docs/api/quote. We use this single endpoint —
// not the /stock/profile2 or /stock/metric endpoints — because
// /quote returns price + change + percent_change in one call, which
// is exactly what the renderer's grid and the voice readbacks need.
// Volume is intentionally not fetched (see types.ts).
//
// Failure taxonomy:
//   - missing API key       → throw QuoteClientError('no_api_key')
//   - HTTP non-200          → throw QuoteClientError('http_error', { status })
//   - rate limited (429)    → throw QuoteClientError('rate_limited')
//   - malformed response    → throw QuoteClientError('malformed', { reason })
//   - unknown symbol        → throw QuoteClientError('unknown_symbol')
// The handler / poller map these to MeshDeny reasons (finance_<reason>)
// or log lines.

const BASE_URL = 'https://finnhub.io/api/v1/quote'
const FETCH_TIMEOUT_MS = 15_000

export type QuoteClientReason =
  | 'no_api_key'
  | 'http_error'
  | 'rate_limited'
  | 'malformed'
  | 'unknown_symbol'

export class QuoteClientError extends Error {
  constructor(
    public readonly reason: QuoteClientReason,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(`${reason}: ${JSON.stringify(details)}`)
    this.name = 'QuoteClientError'
  }
}

// Finnhub's /quote response. Fields documented at
// https://finnhub.io/docs/api/quote — c = current, d = change,
// dp = change percent, h/l/o = high/low/open (unused),
// pc = previous close (unused), t = unix-seconds timestamp.
//
// Error responses are signalled either by HTTP status (4xx/429) or by
// an "error" string in the body (e.g. invalid API key returns 401 +
// {"error": "Invalid API key"}). An unknown but well-formed symbol
// returns HTTP 200 with all numeric fields set to 0.
interface FinnhubQuote {
  c?: number
  d?: number | null
  dp?: number | null
  h?: number
  l?: number
  o?: number
  pc?: number
  t?: number
  error?: string
}

export interface QuoteClientOptions {
  apiKey: string
  /** Override for tests. */
  fetchImpl?: typeof fetch
}

export class QuoteClient {
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch

  constructor(opts: QuoteClientOptions) {
    if (!opts.apiKey) {
      throw new QuoteClientError('no_api_key')
    }
    this.apiKey = opts.apiKey
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  async fetchQuote(symbol: string): Promise<Quote> {
    const upper = symbol.toUpperCase()
    const url =
      `${BASE_URL}?symbol=${encodeURIComponent(upper)}` +
      `&token=${encodeURIComponent(this.apiKey)}`

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await this.fetchImpl(url, { signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
    if (res.status === 429) {
      throw new QuoteClientError('rate_limited', { status: 429 })
    }
    if (res.status !== 200) {
      // Surface the body for 4xx so an invalid API key shows up in the
      // log file as something more actionable than "http_error: 401".
      let bodyHint: unknown
      try {
        bodyHint = await res.json()
      } catch {
        /* ignore */
      }
      throw new QuoteClientError('http_error', { status: res.status, body: bodyHint })
    }
    let data: FinnhubQuote
    try {
      data = (await res.json()) as FinnhubQuote
    } catch (e) {
      throw new QuoteClientError('malformed', { reason: (e as Error).message })
    }

    if (typeof data.error === 'string' && data.error.length > 0) {
      throw new QuoteClientError('http_error', { upstream: data.error })
    }

    // Finnhub returns all-zeros (and pc=0) for unknown-but-well-formed
    // symbols — the API has no separate 404 path. Treat as unknown_symbol
    // so the handler can map it to MeshDeny rather than a confusing
    // "AAPL is at $0.00" quote.
    if (typeof data.c !== 'number' || data.c === 0) {
      throw new QuoteClientError('unknown_symbol', { symbol: upper, body: data })
    }
    if (typeof data.d !== 'number' || typeof data.dp !== 'number') {
      // Some symbols (ETFs at session start, halted stocks) come back
      // with c set but d/dp null. Treat as malformed for v1 — the
      // renderer's empty/error state handles the upstream's gaps better
      // than a "change: null" surface payload would.
      throw new QuoteClientError('malformed', { reason: 'change_fields_null', body: data })
    }

    return {
      symbol: upper,
      price: data.c,
      change: data.d,
      change_percent: data.dp,
      latest_trading_day: unixToTradingDay(data.t),
      fetched_at: new Date().toISOString(),
    }
  }
}

// Finnhub timestamps are unix seconds. We want a YYYY-MM-DD string in
// UTC so cards display a stable trading-day label across timezones.
// A zero / missing timestamp falls back to today's date — the upstream
// gap is preferable to an empty cell, and the price itself is the
// load-bearing data.
function unixToTradingDay(t: number | undefined): string {
  const seconds = typeof t === 'number' && t > 0 ? t : Math.floor(Date.now() / 1000)
  const d = new Date(seconds * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
