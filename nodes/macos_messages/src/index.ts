import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode, MeshDeny, type Envelope } from '@aether/mesh-node-sdk'
import { MessagesPoller } from './poller'
import { MessagesStore } from './storage'

const NODE_ID = 'macos_messages'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

interface RecentArgs {
  limit?: number
  since?: string
}

function log(msg: string): void {
  // Mesh nodes don't share stdout with anyone speaking a structured
  // protocol — Core consumes the HTTP/SSE stream over loopback, not
  // stdout — so plain stdout is safe here. (See CLAUDE.md §10
  // "Stdout pollution breaks JSON-RPC daemons" for the case where
  // it isn't.)
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT
  const n = Math.floor(value)
  if (n < 1) return 1
  if (n > MAX_LIMIT) return MAX_LIMIT
  return n
}

function makeRecentHandler(store: MessagesStore) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = env.payload as RecentArgs
    const limit = clampLimit(payload?.limit ?? DEFAULT_LIMIT)
    const since = typeof payload?.since === 'string' ? payload.since : undefined
    if (since !== undefined) {
      // Cheap parse-check so a malformed string falls out with a
      // clean MeshDeny rather than an opaque comparison downstream.
      const t = Date.parse(since)
      if (Number.isNaN(t)) {
        throw new MeshDeny('macos_messages_bad_since', { since })
      }
    }
    const messages = store.recent({ limit, since })
    return { messages }
  }
}

async function main(): Promise<void> {
  const secret = process.env.MESH_MACOS_MESSAGES_SECRET
  if (!secret) {
    process.stderr.write(
      `[${NODE_ID}] MESH_MACOS_MESSAGES_SECRET is required; refusing to start.\n`,
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

  const nodeDir = join(dataDir, 'macos_messages')
  mkdirSync(nodeDir, { recursive: true })
  const dbPath = join(nodeDir, 'messages.db')
  const markerPath = join(nodeDir, 'running')

  const store = new MessagesStore(dbPath)
  log(`storage opened at ${dbPath} (existing rows=${store.count()})`)

  const node = new MeshNode(NODE_ID, secret, CORE_URL)
  node.on('recent', makeRecentHandler(store))
  await node.start()
  log(`registered with core at ${CORE_URL}`)

  writeFileSync(markerPath, `${process.pid}\n${new Date().toISOString()}\n`)

  const poller = new MessagesPoller({ store, log })
  poller.start()
  log(`poller started — 30s cadence`)

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
      poller.stop()
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
