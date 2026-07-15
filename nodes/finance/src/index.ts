import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode, MeshDeny, type Envelope } from '@aether/mesh-node-sdk'
import { QuoteClient, QuoteClientError } from './client'
import { QuoteStore } from './storage'
import { readCache, writeCache } from './cache'
import { QuoteHistory } from './history'
import { QuotePoller } from './poller'
import { TICKERS, isTracked, findTicker, searchTickers } from './tickers'
import { CHART_RANGES, type ChartRange, type Quote } from './types'

const NODE_ID = 'finance'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

// finance.history period enum. Ordered shortest → longest so the JSON
// Schema enum, this set, and the voice tool's mapping share one
// reading order. 'all' is the full retained window (90d, see history.ts
// RETENTION_DAYS). Extending the enum (e.g. '6m') is a code change here
// + schema bump + voice-tool mapping — same intentional friction as
// news_feeds categories.
const VALID_PERIODS = new Set(['1d', '1w', '1m', 'all'])
const DEFAULT_PERIOD = '1w'
const MS_PER_DAY = 24 * 60 * 60 * 1000

// finance.chart range enum (#354). Distinct from history's periods — these
// are live upstream Yahoo-chart spans (see client.fetchChart). Validated
// here, mirrored in schemas/chart.json and the ChartRange type.
const VALID_RANGES = new Set<string>(CHART_RANGES)
const DEFAULT_RANGE: ChartRange = '1M'

// Chart responses are cached briefly so toggling the span back and forth
// (or two viewers on the same ticker) doesn't re-hit Yahoo each time. The
// detail-page chart is interactive, not a 30s poll, so a short TTL keeps
// it responsive without going stale on a meaningful timescale.
const CHART_CACHE_TTL_MS = 2 * 60_000

interface QuoteArgs {
  symbol?: unknown
}

interface HistoryArgs {
  symbol?: unknown
  period?: unknown
}

interface ChartArgs {
  symbol?: unknown
  range?: unknown
}

interface SearchArgs {
  query?: unknown
  limit?: unknown
}

function log(msg: string): void {
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

// Attach the catalog's display name + sector to an upstream Quote. The
// upstream feed doesn't carry our curated sector tag; the node owns it
// (tickers.ts) and stamps it at the surface boundary so the app can group
// + label without a second round-trip. Untracked-but-cached symbols (none
// in practice) pass through unenriched.
function enrich(quote: Quote): Quote {
  const meta = findTicker(quote.symbol)
  if (!meta) return quote
  return { ...quote, name: meta.name, sector: meta.sector }
}

function makeQuoteHandler(store: QuoteStore, poller: QuotePoller) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = env.payload as QuoteArgs
    const symbol = typeof payload?.symbol === 'string' ? payload.symbol.toUpperCase() : ''
    if (!symbol) {
      throw new MeshDeny('finance_bad_symbol', { detail: 'symbol_required' })
    }
    if (!isTracked(symbol)) {
      // Enforced here, not just at the schema layer, so the tracked list
      // can grow without touching the JSON schema. Keeps rate-limit usage
      // bounded — arbitrary symbols would let any caller burn the daily
      // quota.
      throw new MeshDeny('finance_untracked_symbol', {
        symbol,
        tracked: TICKERS.map((t) => t.symbol),
      })
    }

    const fresh = store.getFresh(symbol)
    if (fresh) {
      return { quote: enrich(fresh) }
    }

    try {
      await poller.fetchOnce(symbol)
    } catch (e) {
      if (e instanceof QuoteClientError) {
        throw new MeshDeny(`finance_${e.reason}`, { symbol, ...e.details })
      }
      throw new MeshDeny('finance_fetch_failed', {
        symbol,
        details: (e as Error).message,
      })
    }
    const after = store.getFresh(symbol)
    if (!after) {
      // Defensive: a fulfilled fetchOnce that didn't populate would be a
      // bug in the poller. Surface explicitly.
      throw new MeshDeny('finance_no_quote_after_fetch', { symbol })
    }
    return { quote: enrich(after) }
  }
}

function makeMarketSummaryHandler(store: QuoteStore) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    // No on-demand refresh here. The poller drives cache state on its
    // own cadence; market_summary is a cheap read of whatever is
    // currently cached. The app's 30s refresh exists to pick up poller
    // writes, not to force new fetches. Quotes are enriched with the
    // catalog name + sector so the app can group/label client-side.
    const payload = env.payload as { sector?: unknown }
    const sectorFilter =
      typeof payload?.sector === 'string' ? payload.sector.trim().toLowerCase() : ''
    let quotes = store.getAll().map(enrich)
    if (sectorFilter) {
      quotes = quotes.filter((q) => (q.sector ?? '').toLowerCase() === sectorFilter)
    }
    return { quotes }
  }
}

// Period → since-iso lower bound for the history query. 'all' is the
// epoch so the store returns whatever is retained (capped at 90 days
// by the poller's prune step). Day-counts are calendar-loose: '1m' is
// 30 days, not last-calendar-month — close enough for the voice tool's
// "this month" summary and avoids the timezone-month-boundary hairball.
function periodToSinceIso(period: string): string {
  const now = Date.now()
  if (period === '1d') return new Date(now - 1 * MS_PER_DAY).toISOString()
  if (period === '1w') return new Date(now - 7 * MS_PER_DAY).toISOString()
  if (period === '1m') return new Date(now - 30 * MS_PER_DAY).toISOString()
  if (period === 'all') return new Date(0).toISOString()
  return new Date(now - 7 * MS_PER_DAY).toISOString()
}

function makeHistoryHandler(history: QuoteHistory) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = env.payload as HistoryArgs
    const symbol =
      typeof payload?.symbol === 'string' ? payload.symbol.toUpperCase() : ''
    if (!symbol) {
      throw new MeshDeny('finance_bad_symbol', { detail: 'symbol_required' })
    }
    if (!isTracked(symbol)) {
      // Same belt-and-braces check as finance.quote: the JSON Schema
      // doesn't enforce tracked-list membership (so the tracked set
      // can grow without a schema bump), so we enforce here.
      throw new MeshDeny('finance_untracked_symbol', {
        symbol,
        tracked: TICKERS.map((t) => t.symbol),
      })
    }
    const rawPeriod =
      typeof payload?.period === 'string' ? payload.period : DEFAULT_PERIOD
    if (!VALID_PERIODS.has(rawPeriod)) {
      throw new MeshDeny('finance_bad_period', {
        period: rawPeriod,
        valid: Array.from(VALID_PERIODS),
      })
    }
    const sinceIso = periodToSinceIso(rawPeriod)
    const points = history.points(symbol, sinceIso)
    // Empty array is the honest first-day answer — never an error. The
    // sparkline skips render below the 3-point threshold; the voice
    // tool says "insufficient history" below 2 samples.
    return { points }
  }
}

// finance.chart — live upstream Yahoo-chart fetch for the detail page's
// multi-span price chart (#354). Distinct from finance.history (passive
// accumulation, sparkline). A short per-(symbol,range) cache absorbs span
// toggling; entries are not persisted — restart-fresh is correct for a
// live chart. See DECISIONS "finance.chart upstream fetch for the detail
// page" for why this surface, unlike history, fetches upstream.
function makeChartHandler(client: QuoteClient) {
  const cache = new Map<string, { points: unknown[]; atMs: number }>()
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = env.payload as ChartArgs
    const symbol =
      typeof payload?.symbol === 'string' ? payload.symbol.toUpperCase() : ''
    if (!symbol) {
      throw new MeshDeny('finance_bad_symbol', { detail: 'symbol_required' })
    }
    if (!isTracked(symbol)) {
      throw new MeshDeny('finance_untracked_symbol', {
        symbol,
        tracked: TICKERS.map((t) => t.symbol),
      })
    }
    const rawRange =
      typeof payload?.range === 'string' ? payload.range.toUpperCase() : DEFAULT_RANGE
    if (!VALID_RANGES.has(rawRange)) {
      throw new MeshDeny('finance_bad_range', {
        range: rawRange,
        valid: Array.from(VALID_RANGES),
      })
    }
    const range = rawRange as ChartRange
    const key = `${symbol}:${range}`
    const hit = cache.get(key)
    if (hit && Date.now() - hit.atMs < CHART_CACHE_TTL_MS) {
      return { symbol, range, points: hit.points }
    }
    let points: unknown[]
    try {
      points = await client.fetchChart(symbol, range)
    } catch (e) {
      if (e instanceof QuoteClientError) {
        throw new MeshDeny(`finance_${e.reason}`, { symbol, range, ...e.details })
      }
      throw new MeshDeny('finance_chart_failed', {
        symbol,
        range,
        details: (e as Error).message,
      })
    }
    cache.set(key, { points, atMs: Date.now() })
    return { symbol, range, points }
  }
}

// finance.search — catalog-only substring search over the tracked
// universe (symbol + name). No upstream call. Backs the app's search box
// and the stock_search voice tool ("find {name} stock").
function makeSearchHandler() {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = env.payload as SearchArgs
    const query = typeof payload?.query === 'string' ? payload.query : ''
    if (!query.trim()) {
      throw new MeshDeny('finance_bad_query', { detail: 'query_required' })
    }
    const limit =
      typeof payload?.limit === 'number' && payload.limit > 0
        ? Math.min(Math.floor(payload.limit), 100)
        : 25
    const matches = searchTickers(query, limit).map((t) => ({
      symbol: t.symbol,
      name: t.name,
      sector: t.sector,
    }))
    return { query: query.trim(), matches, count: matches.length }
  }
}

function makeMoversHandler(store: QuoteStore) {
  return async (): Promise<Record<string, unknown>> => {
    // Calculate movers from cached quotes. No on-demand refresh — same
    // pattern as market_summary. Returns top 10 gainers + top 10 losers
    // by change_percent from the tracked set.
    const quotes = store.getAll()
    if (quotes.length === 0) {
      return {
        available: false,
        reason: 'no_data_yet',
        [Symbol.for('index-signature')]: undefined,
      }
    }
    // Filter to quotes with valid change_percent, then sort
    const withChange = quotes.filter(
      (q) => typeof q.change_percent === 'number' && !Number.isNaN(q.change_percent),
    )
    if (withChange.length === 0) {
      return {
        available: false,
        reason: 'no_valid_data',
        [Symbol.for('index-signature')]: undefined,
      }
    }
    const sorted = [...withChange].sort((a, b) => {
      const aVal = a.change_percent as number
      const bVal = b.change_percent as number
      return bVal - aVal
    })
    const gainers = sorted.slice(0, 10)
    const losers = sorted.slice(-10).reverse()
    return {
      available: true,
      gainers,
      losers,
      [Symbol.for('index-signature')]: undefined,
    }
  }
}

// SPDR sector ETF tickers. Standard 11-sector GICS classification.
const SECTOR_ETFS = [
  { symbol: 'XLK', name: 'Technology' },
  { symbol: 'XLF', name: 'Financials' },
  { symbol: 'XLV', name: 'Health Care' },
  { symbol: 'XLY', name: 'Consumer Discretionary' },
  { symbol: 'XLP', name: 'Consumer Staples' },
  { symbol: 'XLI', name: 'Industrials' },
  { symbol: 'XLE', name: 'Energy' },
  { symbol: 'XLU', name: 'Utilities' },
  { symbol: 'XLB', name: 'Materials' },
  { symbol: 'XLRE', name: 'Real Estate' },
  { symbol: 'XLC', name: 'Communication Services' },
]

function makeSectorsHandler(store: QuoteStore) {
  return async (): Promise<Record<string, unknown>> => {
    // Read sector ETF quotes from cache. These tickers must be in the
    // tracked list (added by this PR) for the poller to populate them.
    const quotes = store.getAll()
    const sectorSymbols = new Set(SECTOR_ETFS.map((s) => s.symbol))
    const sectorQuotes = quotes.filter((q) => sectorSymbols.has(q.symbol))
    if (sectorQuotes.length === 0) {
      return {
        available: false,
        reason: 'no_sector_data_yet',
        [Symbol.for('index-signature')]: undefined,
      }
    }
    // Enrich with sector name from the mapping
    const sectors = sectorQuotes.map((q) => {
      const meta = SECTOR_ETFS.find((s) => s.symbol === q.symbol)
      return {
        symbol: q.symbol,
        name: meta?.name ?? q.symbol,
        price: q.price,
        change: q.change,
        change_percent: q.change_percent,
      }
    })
    return {
      available: true,
      sectors,
      [Symbol.for('index-signature')]: undefined,
    }
  }
}

function makeEarningsHandler() {
  return async (): Promise<Record<string, unknown>> => {
    // Earnings calendar requires a different Yahoo Finance API surface
    // (earnings_dates, not quote). Deferred to a future PR — the voice
    // tool and schema exist to reserve the surface name and prove the
    // voice-registration path, but the implementation returns unavailable
    // in this PR.
    return {
      available: false,
      reason: 'not_implemented_yet',
      message:
        'Earnings calendar requires yfinance.Ticker(...).earnings_dates; deferred to follow-up PR',
      [Symbol.for('index-signature')]: undefined,
    }
  }
}

// Market overview indices. VIX, TNX (10Y Treasury yield), DXY (USD index)
// require different data sources than Yahoo quote — they're futures or
// computed indices, not equities. For v1 we surface the broad equity ETFs
// only (SPY/QQQ/DIA) which are already tracked.
const OVERVIEW_TICKERS = ['SPY', 'QQQ', 'DIA']

function makeMarketOverviewHandler(store: QuoteStore) {
  return async (): Promise<Record<string, unknown>> => {
    const quotes = store.getAll()
    const overviewSymbols = new Set(OVERVIEW_TICKERS)
    const overviewQuotes = quotes.filter((q) => overviewSymbols.has(q.symbol))
    if (overviewQuotes.length === 0) {
      return {
        available: false,
        reason: 'no_overview_data_yet',
        [Symbol.for('index-signature')]: undefined,
      }
    }
    // Build a keyed response: spy, qqq, dia. VIX / treasury / USD deferred.
    const result: Record<string, unknown> = {
      available: true,
      [Symbol.for('index-signature')]: undefined,
    }
    for (const q of overviewQuotes) {
      const key = q.symbol.toLowerCase()
      result[key] = {
        symbol: q.symbol,
        price: q.price,
        change: q.change,
        change_percent: q.change_percent,
      }
    }
    // Placeholder fields for future additions
    result.vix = null
    result.ten_year_treasury = null
    result.usd_index = null
    return result
  }
}

async function main(): Promise<void> {
  const secret = process.env.MESH_FINANCE_SECRET
  if (!secret) {
    process.stderr.write(
      `[${NODE_ID}] MESH_FINANCE_SECRET is required; refusing to start.\n`,
    )
    process.exit(2)
  }
  const dataDir = process.env.AETHER_DATA_DIR
  if (!dataDir) {
    process.stderr.write(
      `[${NODE_ID}] AETHER_DATA_DIR is required; refusing to start.\n`,
    )
    process.exit(2)
  }
  // The marker file under AETHER_DATA_DIR is the node's own liveness
  // signal (matches the news_feeds pattern). The directory now ALSO
  // hosts history.db — the in-memory current-quote cache is still
  // in-memory (storage.ts), but the historical time series is
  // persisted (see history.ts header for why these two are split).
  const nodeDir = join(dataDir, 'finance')
  mkdirSync(nodeDir, { recursive: true })
  const markerPath = join(nodeDir, 'running')
  const historyDbPath = join(nodeDir, 'history.db')

  const client = new QuoteClient({ log })
  const store = new QuoteStore()
  const history = new QuoteHistory(historyDbPath)
  log(`history db opened at ${historyDbPath} (existing rows=${history.count()})`)

  // Hydrate the in-memory store from the on-disk cache so surfaces can
  // respond immediately on a cold start, before the first poll cycle lands.
  const cached = readCache(nodeDir, log)
  if (cached !== null) {
    store.hydrate(cached.data)
  }

  const node = new MeshNode(NODE_ID, secret, CORE_URL)

  const poller = new QuotePoller({
    tickers: TICKERS,
    client,
    store,
    history,
    log,
    onCycleDone: () => {
      try {
        writeCache(nodeDir, store.serialize(), log)
      } catch (e) {
        log(`cache write failed: ${(e as Error).message}`)
      }
    },
  })

  node.on('quote', makeQuoteHandler(store, poller))
  node.on('market_summary', makeMarketSummaryHandler(store))
  node.on('history', makeHistoryHandler(history))
  node.on('chart', makeChartHandler(client))
  node.on('search', makeSearchHandler())
  node.on('movers', makeMoversHandler(store))
  node.on('sectors', makeSectorsHandler(store))
  node.on('earnings', makeEarningsHandler())
  node.on('market_overview', makeMarketOverviewHandler(store))

  await node.start()
  log(`registered with core at ${CORE_URL}`)

  writeFileSync(markerPath, `${process.pid}\n${new Date().toISOString()}\n`)

  poller.start()
  log(`poller started — ${TICKERS.length} tickers, first cycle in-flight`)

  let shuttingDown = false
  const shutdown = async (sig: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    log(`received ${sig}, stopping`)
    try {
      unlinkSync(markerPath)
    } catch {
      /* already gone */
    }
    try {
      await poller.stop()
    } catch (e) {
      log(`poller stop error: ${(e as Error).message}`)
    }
    try {
      await node.stop()
    } catch {
      /* best-effort */
    }
    try {
      history.close()
    } catch {
      /* best-effort */
    }
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  process.stderr.write(`[${NODE_ID}] fatal: ${(err as Error).stack ?? err}\n`)
  process.exit(1)
})
