import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode, MeshDeny } from '@aether/mesh-node-sdk'
import { fetchIntrospection } from './broker_client'
import type { BrokerIntrospection, FetchErrorKind } from './types'

const NODE_ID = 'mesh_introspection'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

const POLL_INTERVAL_MS = 2_000
// 10s is comfortably more than 4× the poll interval, so a single
// transient miss doesn't flag the cache as stale.
const STALE_AFTER_MS = 10_000

interface Cache {
  data: BrokerIntrospection
  fetchedAtMs: number
}

function log(msg: string): void {
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

function makeTopologyHandler(getState: () => CacheState) {
  return async (): Promise<Record<string, unknown>> => {
    const state = getState()
    if (!state.cache) {
      throw new MeshDeny('broker_unreachable', {
        last_error: state.lastError ?? 'no_fetch_yet',
      })
    }
    const ageMs = Date.now() - state.cache.fetchedAtMs
    const stale = ageMs > STALE_AFTER_MS
    return {
      nodes: state.cache.data.nodes,
      edges: state.cache.data.edges,
      stale,
      fetched_at_ms: state.cache.fetchedAtMs,
    }
  }
}

function makeActivityHandler(getState: () => CacheState) {
  return async (): Promise<Record<string, unknown>> => {
    const state = getState()
    if (!state.cache) {
      throw new MeshDeny('broker_unreachable', {
        last_error: state.lastError ?? 'no_fetch_yet',
      })
    }
    const ageMs = Date.now() - state.cache.fetchedAtMs
    const stale = ageMs > STALE_AFTER_MS
    return {
      activity: state.cache.data.activity,
      stale,
      fetched_at_ms: state.cache.fetchedAtMs,
    }
  }
}

interface CacheState {
  cache: Cache | null
  lastError: FetchErrorKind | null
}

async function main(): Promise<void> {
  const secret = process.env.MESH_MESH_INTROSPECTION_SECRET
  if (!secret) {
    process.stderr.write(
      `[${NODE_ID}] MESH_MESH_INTROSPECTION_SECRET is required; refusing to start.\n`,
    )
    process.exit(2)
  }
  const adminToken = process.env.ADMIN_TOKEN
  if (!adminToken) {
    process.stderr.write(
      `[${NODE_ID}] ADMIN_TOKEN is required; refusing to start.\n`,
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

  const nodeDir = join(dataDir, NODE_ID)
  mkdirSync(nodeDir, { recursive: true })
  const markerPath = join(nodeDir, 'running')

  const state: CacheState = { cache: null, lastError: null }
  const getState = (): CacheState => state

  const node = new MeshNode(NODE_ID, secret, CORE_URL)
  node.on('topology', makeTopologyHandler(getState))
  node.on('activity', makeActivityHandler(getState))
  await node.start()
  log(`registered with core at ${CORE_URL}`)

  writeFileSync(markerPath, `${process.pid}\n${new Date().toISOString()}\n`)
  log(`liveness marker written to ${markerPath}`)

  const poll = async (): Promise<void> => {
    const result = await fetchIntrospection(CORE_URL, adminToken)
    if (result.ok) {
      state.cache = { data: result.data, fetchedAtMs: Date.now() }
      if (state.lastError !== null) {
        log(`broker fetch recovered (last error: ${state.lastError})`)
        state.lastError = null
      }
      return
    }
    if (state.lastError !== result.kind) {
      log(`broker fetch failing: ${result.kind}`)
      state.lastError = result.kind
    }
  }

  // Fire once immediately so the cache warms before the first surface
  // invocation; then settle into the 2s cadence.
  await poll()
  const timer = setInterval(() => {
    void poll()
  }, POLL_INTERVAL_MS)

  let shuttingDown = false
  const shutdown = async (sig: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    log(`received ${sig}, stopping`)
    clearInterval(timer)
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
