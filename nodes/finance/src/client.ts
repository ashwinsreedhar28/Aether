import type { Quote } from './types'

// Thin Alpha Vantage GLOBAL_QUOTE client. Free-tier endpoint documented at
// https://www.alphavantage.co/documentation/#latestprice. We do not use the
// TIME_SERIES_INTRADAY endpoint — GLOBAL_QUOTE gives price/change/volume in
// a single request, which is what the renderer's grid and the voice
// readbacks need.
//
// Failure taxonomy:
//   - missing API key       → throw QuoteClientError('no_api_key')
//   - HTTP non-200          → throw QuoteClientError('http_error', { status })
//   - rate limited          → throw QuoteClientError('rate_limited')
//   - malformed response    → throw QuoteClientError('malformed', { reason })
//   - unknown symbol        → throw QuoteClientError('unknown_symbol')
// The handler / poller map these to MeshDeny reasons or log lines.

const BASE_URL = 'https://www.alphavantage.co/query'
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

interface GlobalQuoteEnvelope {
  'Global Quote'?: {
    '01. symbol'?: string
    '05. price'?: string
    '06. volume'?: string
    '07. latest trading day'?: string
    '09. change'?: string
    '10. change percent'?: string
  }
  Note?: string
  Information?: string
  'Error Message'?: string
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
      `${BASE_URL}?function=GLOBAL_QUOTE` +
      `&symbol=${encodeURIComponent(upper)}` +
      `&apikey=${encodeURIComponent(this.apiKey)}`

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
      throw new QuoteClientError('http_error', { status: res.status })
    }
    let data: GlobalQuoteEnvelope
    try {
      data = (await res.json()) as GlobalQuoteEnvelope
    } catch (e) {
      throw new QuoteClientError('malformed', { reason: (e as Error).message })
    }

    // Alpha Vantage signals rate-limit and informational responses with
    // 200 + a Note / Information field instead of an HTTP error. The
    // free-tier daily cap surfaces here as Information; the per-minute
    // throttle surfaces here as Note. Treat both as rate_limited.
    if (typeof data.Note === 'string' || typeof data.Information === 'string') {
      throw new QuoteClientError('rate_limited', {
        note: data.Note,
        info: data.Information,
      })
    }
    if (typeof data['Error Message'] === 'string') {
      throw new QuoteClientError('unknown_symbol', {
        symbol: upper,
        upstream: data['Error Message'],
      })
    }

    const gq = data['Global Quote']
    // An empty `Global Quote: {}` is what Alpha Vantage returns for a
    // valid-looking-but-unknown symbol (e.g. typo). Treat as unknown.
    if (!gq || typeof gq['05. price'] !== 'string') {
      throw new QuoteClientError('unknown_symbol', { symbol: upper })
    }

    const price = parseNumeric(gq['05. price'])
    const change = parseNumeric(gq['09. change'])
    const changePercent = parsePercent(gq['10. change percent'])
    const volume = parseNumeric(gq['06. volume'])
    const latestDay = typeof gq['07. latest trading day'] === 'string' ? gq['07. latest trading day'] : ''
    const reportedSymbol = typeof gq['01. symbol'] === 'string' ? gq['01. symbol'] : upper
    if (price === null || change === null || changePercent === null) {
      throw new QuoteClientError('malformed', { reason: 'unparsable numeric', upstream: gq })
    }

    return {
      symbol: reportedSymbol.toUpperCase(),
      price,
      change,
      change_percent: changePercent,
      volume: volume ?? 0,
      latest_trading_day: latestDay,
      fetched_at: new Date().toISOString(),
    }
  }
}

function parseNumeric(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Alpha Vantage returns the change percent as a string with a trailing
// '%' (e.g. "1.2345%"). Strip and parse; absent → null so the caller can
// surface a malformed-response error rather than silently treating it as 0.
function parsePercent(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const stripped = v.endsWith('%') ? v.slice(0, -1) : v
  const n = Number(stripped)
  return Number.isFinite(n) ? n : null
}
