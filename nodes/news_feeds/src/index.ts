import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode, MeshDeny, type Envelope } from '@homeos/mesh-node-sdk'
import { FEEDS } from './feeds'
import { FeedPoller } from './fetcher'
import { ArticleStore } from './storage'

const NODE_ID = 'news_feeds'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

interface RecentArgs {
  limit?: number
  since?: string
}

function log(msg: string): void {
  // Mesh nodes don't share stdout with anyone speaking a structured
  // protocol — Core consumes the HTTP/SSE stream over loopback, not
  // stdout — so plain stdout is safe here. (See CLAUDE.md §10 "Stdout
  // pollution breaks JSON-RPC daemons" for the case where it isn't.)
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT
  const n = Math.floor(value)
  if (n < 1) return 1
  if (n > MAX_LIMIT) return MAX_LIMIT
  return n
}

function makeRecentHandler(store: ArticleStore) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = env.payload as RecentArgs
    const limit = clampLimit(payload?.limit ?? DEFAULT_LIMIT)
    const since = typeof payload?.since === 'string' ? payload.since : undefined
    if (since !== undefined) {
      // Cheap parse-check so a malformed string falls out with a clean
      // MeshDeny rather than an opaque sqlite comparison.
      const t = Date.parse(since)
      if (Number.isNaN(t)) {
        throw new MeshDeny('news_feeds_bad_since', { since })
      }
    }
    const articles = store.recent({ limit, since })
    return { articles }
  }
}

async function main(): Promise<void> {
  const secret = process.env.MESH_NEWS_FEEDS_SECRET
  if (!secret) {
    process.stderr.write(
      `[${NODE_ID}] MESH_NEWS_FEEDS_SECRET is required; refusing to start.\n`,
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

  const nodeDir = join(dataDir, 'news_feeds')
  mkdirSync(nodeDir, { recursive: true })
  const dbPath = join(nodeDir, 'news.db')
  const markerPath = join(nodeDir, 'running')

  const store = new ArticleStore(dbPath)
  log(`storage opened at ${dbPath} (existing rows=${store.count()})`)

  const node = new MeshNode(NODE_ID, secret, CORE_URL)
  node.on('recent', makeRecentHandler(store))
  await node.start()
  log(`registered with core at ${CORE_URL}`)

  // Marker file: written after successful registration so the shell (or any
  // other external observer) can tell at a glance whether the node is up.
  // PID file is owned by the spawning shell process; this marker is owned
  // by the node itself, which makes it the right liveness signal — Core
  // would have rejected register() if the secret were wrong, so a marker
  // existing means the node is signed in and serving.
  writeFileSync(markerPath, `${process.pid}\n${new Date().toISOString()}\n`)

  const poller = new FeedPoller({ feeds: FEEDS, store, log })
  void poller.start()
  log(`poller started — ${FEEDS.length} feeds, first poll in-flight`)

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
      store.close()
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
