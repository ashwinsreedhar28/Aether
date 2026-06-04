import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode, MeshDeny, type Envelope } from '@aether/mesh-node-sdk'
import { GapStore } from './storage'

// intents is the mesh's gap sensor — and its first node that persists
// *mesh-authored* data rather than a re-fetchable cache of an external source
// (news_feeds, clipboard_history et al. mirror state that already exists
// elsewhere; a gap record exists nowhere but here). When raven cannot fulfil a
// request — no tool, no surface, no data — it invokes intents.record with a
// one-line description; the gap is appended to an fsync'd JSONL log. The
// intents.list surface reads them back newest-first for the (named next)
// gap-visibility view. First brick of the self-building arc: Aether noticing
// what it can't do.

const NODE_ID = 'intents'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

// Mirrors nodes/intents/schemas/record.json bounds. Validation also happens
// at Core against the schema; clamping/denying here keeps the on-disk record
// well-formed even if a future caller skips Core validation.
const TEXT_MAX = 2000
const CONTEXT_MAX = 4000

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000

interface RecordArgs {
  text?: unknown
  context?: unknown
}

interface ListArgs {
  limit?: unknown
}

function log(msg: string): void {
  // Mesh nodes don't share stdout with anyone speaking a structured protocol —
  // Core consumes the HTTP/SSE stream over loopback, not stdout — so plain
  // stdout is safe. (CLAUDE.md §10 — applies only to JSON-RPC daemons.)
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT
  const n = Math.floor(value)
  if (n < 1) return 1
  if (n > MAX_LIMIT) return MAX_LIMIT
  return n
}

function makeRecordHandler(store: GapStore) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = (env.payload ?? {}) as RecordArgs
    const textRaw = payload.text
    if (typeof textRaw !== 'string' || textRaw.trim().length === 0) {
      throw new MeshDeny('intents_bad_text', { text: textRaw })
    }
    const text = textRaw.trim().slice(0, TEXT_MAX)

    const contextRaw = payload.context
    let context: string | null = null
    if (contextRaw !== undefined && contextRaw !== null) {
      if (typeof contextRaw !== 'string') {
        throw new MeshDeny('intents_bad_context', { context: contextRaw })
      }
      const trimmed = contextRaw.trim()
      context = trimmed.length === 0 ? null : trimmed.slice(0, CONTEXT_MAX)
    }

    const rec = store.record(text, context)
    log(`recorded gap ${rec.id}: ${text}`)
    return { ok: true, id: rec.id }
  }
}

function makeListHandler(store: GapStore) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = (env.payload ?? {}) as ListArgs
    const limit = clampLimit(payload.limit ?? DEFAULT_LIMIT)
    return { gaps: store.list(limit) }
  }
}

async function main(): Promise<void> {
  const secret = process.env.MESH_INTENTS_SECRET
  if (!secret) {
    process.stderr.write(`[${NODE_ID}] MESH_INTENTS_SECRET is required; refusing to start.\n`)
    process.exit(2)
  }
  const dataDir = process.env.AETHER_DATA_DIR
  if (!dataDir) {
    process.stderr.write(`[${NODE_ID}] AETHER_DATA_DIR is required; refusing to start.\n`)
    process.exit(2)
  }

  // Storage path convention: $AETHER_DATA_DIR/<node_id>/<file>, identical to
  // every other persistent node (clipboard_history/clipboard.db,
  // news_feeds/news.db, …). The gap log lives at intents/gaps.jsonl.
  const nodeDir = join(dataDir, NODE_ID)
  mkdirSync(nodeDir, { recursive: true })
  const logPath = join(nodeDir, 'gaps.jsonl')
  const markerPath = join(nodeDir, 'running')

  const store = new GapStore(logPath)
  log(`gap log at ${logPath} (existing gaps=${store.list(MAX_LIMIT).length})`)

  const node = new MeshNode(NODE_ID, secret, CORE_URL)
  node.on('record', makeRecordHandler(store))
  node.on('list', makeListHandler(store))
  await node.start()
  log(`registered with core at ${CORE_URL}`)

  writeFileSync(markerPath, `${process.pid}\n${new Date().toISOString()}\n`)
  log(`liveness marker written to ${markerPath}`)

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
