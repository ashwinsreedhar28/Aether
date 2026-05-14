import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode, MeshDeny, type Envelope } from '@homeos/mesh-node-sdk'
import { QuoteClient, QuoteClientError } from './client'
import { QuoteStore } from './storage'
import { QuoteHistory } from './history'
import { QuotePoller } from './poller'
import { TICKERS, isTracked } from './tickers'

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

interface QuoteArgs {
  symbol?: unknown
}

interface HistoryArgs {
  symbol?: unknown
  period?: unknown
}

function log(msg: string): void {
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

function makeQuoteHandler(store: QuoteStore, poller: QuotePoller) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = env.payload as QuoteArgs
    const symbol = typeof payload?.symbol === 'string' ? payload.symbol.toUpperCase() : ''
    if (!symbol) {
      throw new MeshDeny('finance_bad_symbol', { reason: 'symbol_required' })
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
      return { quote: fresh }
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
    return { quote: after }
  }
}

function makeMarketSummaryHandler(store: QuoteStore) {
  return async (): Promise<Record<string, unknown>> => {
    // No on-demand refresh here. The poller drives cache state on its
    // own cadence; market_summary is a cheap read of whatever is
    // currently cached. The Finance app's 60s refresh exists to pick up
    // poller writes, not to force new fetches.
    return { quotes: store.getAll() }
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
      throw new MeshDeny('finance_bad_symbol', { reason: 'symbol_required' })
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

async function main(): Promise<void> {
  const secret = process.env.MESH_FINANCE_SECRET
  if (!secret) {
    process.stderr.write(
      `[${NODE_ID}] MESH_FINANCE_SECRET is required; refusing to start.\n`,
    )
    process.exit(2)
  }
  const dataDir = process.env.HOMEOS_DATA_DIR
  if (!dataDir) {
    process.stderr.write(
      `[${NODE_ID}] HOMEOS_DATA_DIR is required; refusing to start.\n`,
    )
    process.exit(2)
  }
  // The marker file under HOMEOS_DATA_DIR is the node's own liveness
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
  const node = new MeshNode(NODE_ID, secret, CORE_URL)

  const poller = new QuotePoller({
    tickers: TICKERS,
    client,
    store,
    history,
    log,
  })

  node.on('quote', makeQuoteHandler(store, poller))
  node.on('market_summary', makeMarketSummaryHandler(store))
  node.on('history', makeHistoryHandler(history))

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
