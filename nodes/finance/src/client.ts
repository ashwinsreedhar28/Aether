import YahooFinance from 'yahoo-finance2'
import type { Quote } from './types'

// yahoo-finance2 v3 exports a class (the v2 singleton default export
// was deprecated). The shape we depend on is narrow — just .quote() —
// so we capture that subset as an interface to keep test-injection
// easy (and avoid pulling the library's whole giant types surface into
// our public client shape).
interface YahooLike {
  quote(symbol: string): Promise<unknown>
}

// Singleton instance for production use. v3 prints a Node-22-required
// banner to stderr on construction when running on Node 20; the banner
// is informational (the library still works) and goes to our spawn
// log file. Bumping the repo's Node engines is a separate PR. The
// yahooSurvey notice is suppressed — it's a one-time link to a feedback
// form, not actionable for an automated consumer.
const defaultYahoo: YahooLike = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
}) as unknown as YahooLike

// Quote client — Yahoo Finance primary, Stooq CSV fallback. No API key,
// no per-provider quota to track. Matches the evolved Pulse choice.
//
// Why two providers?
//   - Yahoo gives us price + change + percent_change + volume + a real
//     market timestamp in a single call. It is the right primary.
//   - Yahoo is anonymous and unsupported; it has gone soft for hours at
//     a time historically. Stooq is independent, well-aged, and runs on
//     a simple CSV endpoint. When Yahoo flakes, the fallback keeps the
//     tracked grid populated rather than dropping every consumer into an
//     error state.
//
// Failure taxonomy (consumer-facing):
//   - unknown_symbol  → tracked-list symbol that even Stooq doesn't know
//                       (rare; never happens against our hardcoded list,
//                       but still surfaced so a future ticker-edit catches
//                       a typo cleanly)
//   - malformed       → both providers returned something we can't parse
//   - provider_error  → both providers errored / timed out — Yahoo failed
//                       AND Stooq failed. Yahoo's failure is logged; this
//                       reason is the *combined* signal to the consumer
// No rate_limited reason: there is no key-based quota on either provider.
// MeshDeny.finance_rate_limited is no longer reachable from this node
// (see DECISIONS.md "Second data node" Update entry).

const FETCH_TIMEOUT_MS = 15_000
const STOOQ_URL = 'https://stooq.com/q/l/'

export type QuoteClientReason = 'http_error' | 'malformed' | 'unknown_symbol' | 'provider_error'

export class QuoteClientError extends Error {
  constructor(
    public readonly reason: QuoteClientReason,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(`${reason}: ${JSON.stringify(details)}`)
    this.name = 'QuoteClientError'
  }
}

export interface QuoteClientOptions {
  /** Override for tests / fault injection. Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Override for tests. Defaults to a singleton yahoo-finance2 v3
   *  instance. */
  yahooImpl?: YahooLike
  /** Log sink for non-fatal warnings (e.g. Yahoo failure before Stooq
   *  fallback). Defaults to no-op so the client stays embeddable. */
  log?: (msg: string) => void
}

export class QuoteClient {
  private readonly fetchImpl: typeof fetch
  private readonly yahoo: YahooLike
  private readonly log: (msg: string) => void

  constructor(opts: QuoteClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.yahoo = opts.yahooImpl ?? defaultYahoo
    this.log = opts.log ?? ((): void => {})
  }

  async fetchQuote(symbol: string): Promise<Quote> {
    const upper = symbol.toUpperCase()
    let yahooErr: Error | null = null
    try {
      return await this.fetchYahoo(upper)
    } catch (e) {
      // unknown_symbol is a definitive answer from the upstream — don't
      // hammer Stooq looking for a different verdict on the same symbol.
      if (e instanceof QuoteClientError && e.reason === 'unknown_symbol') {
        throw e
      }
      yahooErr = e as Error
      this.log(`yahoo failed for ${upper}: ${(e as Error).message}; trying stooq`)
    }
    try {
      return await this.fetchStooq(upper)
    } catch (e) {
      if (e instanceof QuoteClientError && e.reason === 'unknown_symbol') {
        // Both providers don't know the symbol. Surface unknown_symbol
        // (not provider_error) so the handler maps to finance_unknown_symbol.
        throw e
      }
      throw new QuoteClientError('provider_error', {
        symbol: upper,
        yahoo: yahooErr?.message ?? 'unknown',
        stooq: (e as Error).message,
      })
    }
  }

  private async fetchYahoo(symbol: string): Promise<Quote> {
    let raw: unknown
    try {
      raw = await this.yahoo.quote(symbol)
    } catch (e) {
      throw new QuoteClientError('http_error', { provider: 'yahoo', message: (e as Error).message })
    }
    // yahoo-finance2 with a single string returns one quote object;
    // an unknown symbol returns null/undefined or an empty result.
    if (!raw || typeof raw !== 'object') {
      throw new QuoteClientError('unknown_symbol', { symbol, provider: 'yahoo' })
    }
    const r = raw as {
      regularMarketPrice?: number
      regularMarketChange?: number
      regularMarketChangePercent?: number
      regularMarketVolume?: number
      regularMarketTime?: Date | number
    }
    if (typeof r.regularMarketPrice !== 'number') {
      throw new QuoteClientError('malformed', {
        provider: 'yahoo',
        reason: 'missing_regularMarketPrice',
      })
    }
    if (
      typeof r.regularMarketChange !== 'number' ||
      typeof r.regularMarketChangePercent !== 'number'
    ) {
      // Halted stocks / pre-IPO can come back with price but no change.
      // Treat as malformed so the consumer sees an error state rather
      // than a "change: null" surface payload.
      throw new QuoteClientError('malformed', {
        provider: 'yahoo',
        reason: 'change_fields_missing',
      })
    }
    return {
      symbol,
      price: r.regularMarketPrice,
      change: r.regularMarketChange,
      change_percent: r.regularMarketChangePercent,
      volume: typeof r.regularMarketVolume === 'number' ? r.regularMarketVolume : 0,
      latest_trading_day: yahooTimeToTradingDay(r.regularMarketTime),
      fetched_at: new Date().toISOString(),
    }
  }

  private async fetchStooq(symbol: string): Promise<Quote> {
    // Stooq's format codes (sd2t2ohlcv): Symbol, Date (ISO), Time,
    // Open, High, Low, Close, Volume. `h` adds the header row; `e=csv`
    // is the CSV response format. US tickers take the `.us` suffix.
    const url =
      `${STOOQ_URL}?s=${encodeURIComponent(symbol.toLowerCase())}.us` +
      `&f=sd2t2ohlcv&h&e=csv`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await this.fetchImpl(url, { signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
    if (res.status !== 200) {
      throw new QuoteClientError('http_error', { provider: 'stooq', status: res.status })
    }
    const text = await res.text()
    return parseStooqCsv(text, symbol)
  }
}

// Yahoo timestamps can come back as Date (yahoo-finance2 unwraps the
// unix-seconds field into a Date for us) or a raw number (defensive).
// We want YYYY-MM-DD in UTC to match the prior Finnhub shape. Missing /
// zero timestamps fall back to today's UTC date — the upstream gap is
// preferable to an empty cell.
function yahooTimeToTradingDay(t: Date | number | undefined): string {
  let d: Date
  if (t instanceof Date) {
    d = t
  } else if (typeof t === 'number' && t > 0) {
    // yahoo-finance2 emits the timestamp in seconds when it doesn't
    // unwrap; coerce to ms for the Date ctor.
    d = new Date(t * 1000)
  } else {
    d = new Date()
  }
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Stooq returns two lines: a header row, then a single data row. Cells
// of an unknown symbol are "N/D" across the board (no separate HTTP
// error path). For a valid row we don't have a prev-close column to
// compute day-change-vs-prev-close, so the fallback path computes
// change vs. the session open. Pulse made the same trade-off — the
// Stooq path is a degraded fallback rather than a primary, and a
// slightly-off change number beats no quote at all.
function parseStooqCsv(text: string, symbol: string): Quote {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) {
    throw new QuoteClientError('malformed', { provider: 'stooq', reason: 'empty_body' })
  }
  const row = lines[1]
  if (!row) {
    throw new QuoteClientError('malformed', { provider: 'stooq', reason: 'missing_data_row' })
  }
  const cells = row.split(',')
  if (cells.length < 8) {
    throw new QuoteClientError('malformed', { provider: 'stooq', reason: 'short_row' })
  }
  // Indices (per sd2t2ohlcv): 0 sym, 1 date, 2 time, 3 open, 4 high,
  // 5 low, 6 close, 7 volume.
  const dateCell = cells[1] ?? ''
  const openCell = cells[3] ?? ''
  const closeCell = cells[6] ?? ''
  const volumeCell = cells[7] ?? ''
  if (dateCell === 'N/D' || closeCell === 'N/D') {
    throw new QuoteClientError('unknown_symbol', { symbol, provider: 'stooq' })
  }
  const open = Number(openCell)
  const close = Number(closeCell)
  const volume = Number(volumeCell)
  if (!Number.isFinite(close) || !Number.isFinite(open)) {
    throw new QuoteClientError('malformed', {
      provider: 'stooq',
      reason: 'non_numeric_price',
      body: row,
    })
  }
  const change = close - open
  const changePercent = open > 0 ? (change / open) * 100 : 0
  return {
    symbol,
    price: close,
    change,
    change_percent: changePercent,
    volume: Number.isFinite(volume) ? volume : 0,
    latest_trading_day: dateCell,
    fetched_at: new Date().toISOString(),
  }
}
