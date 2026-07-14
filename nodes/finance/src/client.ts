import YahooFinance from 'yahoo-finance2'
import type { ChartPoint, ChartRange, Quote } from './types'

// yahoo-finance2 v3 exports a class (the v2 singleton default export
// was deprecated). The shape we depend on is narrow — .quote() (single
// OR batched via an array) and .chart() — so we capture that subset as
// an interface to keep test-injection easy (and avoid pulling the
// library's whole giant types surface into our public client shape).
interface YahooLike {
  quote(symbol: string | string[]): Promise<unknown>
  chart(symbol: string, opts: YahooChartOptions): Promise<unknown>
}

interface YahooChartOptions {
  period1: Date
  period2?: Date
  interval: string
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
//     market timestamp in a single call (and, free, the basic-stats
//     fields the detail page wants: open, day high/low, P/E, market cap,
//     52-week range). It is the right primary.
//   - Yahoo is anonymous and unsupported; it has gone soft for hours at
//     a time historically. Stooq is independent, well-aged, and runs on
//     a simple CSV endpoint. When Yahoo flakes, the fallback keeps the
//     tracked grid populated rather than dropping every consumer into an
//     error state. (Stooq carries only OHLCV — no fundamentals — so the
//     detail page's stats degrade gracefully to whatever is present.)
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
const MS_PER_DAY = 24 * 60 * 60 * 1000

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

// finance.chart range → Yahoo chart interval + lookback window. Mirrors
// Pulse's stocksScheduler RANGE_PARAMS; expressed as a day-count back from
// now since yahoo-finance2's chart() takes period1/period2 dates rather
// than a range string. Intraday intervals for short spans, daily for long.
const CHART_PARAMS: Record<ChartRange, { interval: string; days: number }> = {
  '1D': { interval: '5m', days: 1 },
  '5D': { interval: '30m', days: 5 },
  '1M': { interval: '1d', days: 31 },
  '3M': { interval: '1d', days: 93 },
  '1Y': { interval: '1d', days: 366 },
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

  // Single-symbol fetch with Yahoo → Stooq fallback. Used by the
  // on-demand finance.quote path (cache miss). The batch poll uses
  // fetchQuotes below.
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

  // Batch fetch for the poll cycle. One Yahoo multi-symbol call; if Yahoo
  // returns mostly-empty (the "soft outage" Pulse guards against), fall
  // back to a single batched Stooq CSV request. Returns whatever priced
  // successfully — a missing symbol is logged and skipped, never throws,
  // so one bad ticker can't blank the whole grid.
  async fetchQuotes(symbols: string[]): Promise<Quote[]> {
    const upper = symbols.map((s) => s.toUpperCase())
    if (upper.length === 0) return []
    let yahooQuotes: Quote[] = []
    try {
      yahooQuotes = await this.fetchYahooBatch(upper)
    } catch (e) {
      this.log(`yahoo batch failed: ${(e as Error).message}; trying stooq`)
    }
    // "Mostly null" threshold (Pulse): if fewer than half priced, treat
    // the whole wave as a soft outage and fall back to Stooq.
    if (yahooQuotes.length >= upper.length / 2) {
      return yahooQuotes
    }
    try {
      const stooq = await this.fetchStooqBatch(upper)
      this.log(`stooq batch returned ${stooq.length}/${upper.length} quotes`)
      // Merge: prefer Yahoo's (richer) row when present, fill the rest
      // from Stooq so a partial Yahoo response isn't discarded.
      const bySymbol = new Map(stooq.map((q) => [q.symbol, q]))
      for (const q of yahooQuotes) bySymbol.set(q.symbol, q)
      return Array.from(bySymbol.values())
    } catch (e) {
      this.log(`stooq batch failed: ${(e as Error).message}`)
      return yahooQuotes
    }
  }

  // Historical OHLC for the detail-page chart. Live upstream fetch from
  // Yahoo's chart endpoint — distinct from the passively-accumulated
  // finance.history series (see DECISIONS "finance.chart upstream fetch").
  async fetchChart(symbol: string, range: ChartRange): Promise<ChartPoint[]> {
    const upper = symbol.toUpperCase()
    const params = CHART_PARAMS[range]
    const period1 = new Date(Date.now() - params.days * MS_PER_DAY)
    let raw: unknown
    try {
      raw = await this.yahoo.chart(upper, { period1, interval: params.interval })
    } catch (e) {
      throw new QuoteClientError('http_error', {
        provider: 'yahoo',
        surface: 'chart',
        message: (e as Error).message,
      })
    }
    const quotes = (raw as { quotes?: unknown })?.quotes
    if (!Array.isArray(quotes)) {
      throw new QuoteClientError('malformed', { provider: 'yahoo', surface: 'chart' })
    }
    const points: ChartPoint[] = []
    for (const row of quotes) {
      if (!row || typeof row !== 'object') continue
      const r = row as { date?: unknown; close?: unknown; volume?: unknown }
      const close = typeof r.close === 'number' ? r.close : null
      // Yahoo emits null bars for non-trading slots inside the window;
      // drop them so the line doesn't break.
      if (close === null || !Number.isFinite(close)) continue
      const t =
        r.date instanceof Date
          ? r.date.toISOString()
          : typeof r.date === 'string'
            ? r.date
            : null
      if (!t) continue
      points.push({
        t,
        close,
        volume: typeof r.volume === 'number' ? r.volume : 0,
      })
    }
    return points
  }

  private async fetchYahoo(symbol: string): Promise<Quote> {
    let raw: unknown
    try {
      raw = await this.yahoo.quote(symbol)
    } catch (e) {
      throw new QuoteClientError('http_error', { provider: 'yahoo', message: (e as Error).message })
    }
    return mapYahooQuote(raw, symbol)
  }

  private async fetchYahooBatch(symbols: string[]): Promise<Quote[]> {
    const raw = await this.yahoo.quote(symbols)
    // quote([...]) returns an array; quote(str) returns one object. Be
    // defensive about both.
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : []
    const out: Quote[] = []
    for (const row of rows) {
      const r = row as { symbol?: unknown }
      const sym = typeof r?.symbol === 'string' ? r.symbol.toUpperCase() : ''
      if (!sym) continue
      try {
        out.push(mapYahooQuote(row, sym))
      } catch {
        // Halted / malformed single row — skip, keep the rest.
      }
    }
    return out
  }

  private async fetchStooq(symbol: string): Promise<Quote> {
    const rows = await this.fetchStooqBatch([symbol])
    const hit = rows[0]
    if (!hit) {
      throw new QuoteClientError('unknown_symbol', { symbol, provider: 'stooq' })
    }
    return hit
  }

  private async fetchStooqBatch(symbols: string[]): Promise<Quote[]> {
    // Stooq's format codes (sd2t2ohlcv): Symbol, Date (ISO), Time,
    // Open, High, Low, Close, Volume. `h` adds the header row; `e=csv`
    // is the CSV response format. US tickers take the `.us` suffix. The
    // `s=` param accepts a comma-separated list — one request, many rows.
    const list = symbols.map((s) => `${s.toLowerCase()}.us`).join(',')
    const url = `${STOOQ_URL}?s=${encodeURIComponent(list)}&f=sd2t2ohlcv&h&e=csv`
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
    return parseStooqCsv(text)
  }
}

// Map one yahoo-finance2 quote() result object to our Quote shape.
// Throws QuoteClientError(malformed/unknown_symbol) so the single-symbol
// path can fall through to Stooq; the batch path catches + skips.
function mapYahooQuote(raw: unknown, symbol: string): Quote {
  if (!raw || typeof raw !== 'object') {
    throw new QuoteClientError('unknown_symbol', { symbol, provider: 'yahoo' })
  }
  const r = raw as {
    regularMarketPrice?: number
    regularMarketChange?: number
    regularMarketChangePercent?: number
    regularMarketVolume?: number
    regularMarketTime?: Date | number
    regularMarketOpen?: number
    regularMarketDayHigh?: number
    regularMarketDayLow?: number
    trailingPE?: number
    marketCap?: number
    fiftyTwoWeekHigh?: number
    fiftyTwoWeekLow?: number
  }
  if (typeof r.regularMarketPrice !== 'number') {
    throw new QuoteClientError('malformed', {
      provider: 'yahoo',
      detail: 'missing_regularMarketPrice',
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
      detail: 'change_fields_missing',
    })
  }
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined
  return {
    symbol,
    price: r.regularMarketPrice,
    change: r.regularMarketChange,
    change_percent: r.regularMarketChangePercent,
    volume: typeof r.regularMarketVolume === 'number' ? r.regularMarketVolume : 0,
    latest_trading_day: yahooTimeToTradingDay(r.regularMarketTime),
    fetched_at: new Date().toISOString(),
    open: num(r.regularMarketOpen),
    day_high: num(r.regularMarketDayHigh),
    day_low: num(r.regularMarketDayLow),
    pe_ratio: num(r.trailingPE),
    market_cap: num(r.marketCap),
    fifty_two_week_high: num(r.fiftyTwoWeekHigh),
    fifty_two_week_low: num(r.fiftyTwoWeekLow),
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

// Stooq returns a header row then one data row per requested symbol.
// Cells of an unknown symbol are "N/D" across the board (no separate HTTP
// error path). For a valid row we don't have a prev-close column to
// compute day-change-vs-prev-close, so the fallback path computes change
// vs. the session open. Pulse made the same trade-off — the Stooq path is
// a degraded fallback rather than a primary, and a slightly-off change
// number beats no quote at all. Unknown symbols (N/D rows) are skipped.
function parseStooqCsv(text: string): Quote[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) {
    throw new QuoteClientError('malformed', { provider: 'stooq', detail: 'empty_body' })
  }
  const out: Quote[] = []
  // Skip the header row (index 0).
  for (let i = 1; i < lines.length; i += 1) {
    const row = lines[i]
    if (!row) continue
    // Indices (per sd2t2ohlcv): 0 sym, 1 date, 2 time, 3 open, 4 high,
    // 5 low, 6 close, 7 volume.
    const cells = row.split(',')
    if (cells.length < 8) continue
    const symCell = (cells[0] ?? '').toUpperCase().replace(/\.US$/i, '')
    const dateCell = cells[1] ?? ''
    const openCell = cells[3] ?? ''
    const closeCell = cells[6] ?? ''
    const volumeCell = cells[7] ?? ''
    if (dateCell === 'N/D' || closeCell === 'N/D') continue
    const open = Number(openCell)
    const close = Number(closeCell)
    const volume = Number(volumeCell)
    if (!Number.isFinite(close) || !Number.isFinite(open)) continue
    const change = close - open
    const changePercent = open > 0 ? (change / open) * 100 : 0
    out.push({
      symbol: symCell,
      price: close,
      change,
      change_percent: changePercent,
      volume: Number.isFinite(volume) ? volume : 0,
      latest_trading_day: dateCell,
      fetched_at: new Date().toISOString(),
    })
  }
  return out
}
