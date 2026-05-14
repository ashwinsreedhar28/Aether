import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode, MeshDeny, type Envelope } from '@homeos/mesh-node-sdk'
import { QuoteClient, QuoteClientError } from './client'
import { QuoteStore } from './storage'
import { QuotePoller } from './poller'
import { TICKERS, isTracked } from './tickers'

const NODE_ID = 'finance'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

interface QuoteArgs {
  symbol?: unknown
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
  // signal (matches the news_feeds pattern). No SQLite here — all state
  // lives in-process — so the directory exists only to host the marker.
  const nodeDir = join(dataDir, 'finance')
  mkdirSync(nodeDir, { recursive: true })
  const markerPath = join(nodeDir, 'running')

  const client = new QuoteClient({ log })
  const store = new QuoteStore()
  const node = new MeshNode(NODE_ID, secret, CORE_URL)

  const poller = new QuotePoller({
    tickers: TICKERS,
    client,
    store,
    log,
  })

  node.on('quote', makeQuoteHandler(store, poller))
  node.on('market_summary', makeMarketSummaryHandler(store))

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
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  process.stderr.write(`[${NODE_ID}] fatal: ${(err as Error).stack ?? err}\n`)
  process.exit(1)
})
