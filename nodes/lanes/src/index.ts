import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MeshNode, MeshDeny } from '@aether/mesh-node-sdk'
import { collectLanes } from './git'
import type { Lane, LaneState, LanesSnapshot } from './types'

// lanes is a SENSOR mesh node. It polls `git worktree list` for the shared
// Aether repo and exposes which development lanes (worktrees) are active vs
// idle through ONE surface, `lanes.status`. The cockpit's "which agents are
// working" layer: the dashboard.lanes backdrop (composed by the visualizer)
// watches the very sessions building it.
//
// Activity is a FILE-MTIME heuristic — max(last commit, mtime of each dirty
// file) within a 5-minute window. It does NOT detect a live CC process; a lane
// editing nothing reads idle even with a session attached (documented limit;
// process detection is a future enhancement). See README.

const NODE_ID = 'lanes'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

// Poll cadence and staleness. 30s is 3× the poll interval, so a single transient
// git hiccup doesn't flag the cache stale (mirrors mesh_introspection's ratio).
const POLL_INTERVAL_MS = 10_000
const STALE_AFTER_MS = 30_000

// A lane is 'active' if its freshest activity is within this window. Overridable
// via env purely so a smoke test can force an active→idle transition without
// waiting 5 real minutes.
const ACTIVE_WINDOW_MS = Number.parseInt(process.env.LANES_ACTIVE_WINDOW_MS ?? '', 10) || 300_000

// Repo root derived from the compiled entry: dist/index.js → up three (dist →
// nodes/lanes → nodes → repo root). Works in ANY worktree, and `git worktree
// list` from there returns every worktree of the shared repo regardless.
const REPO_ROOT = resolve(__dirname, '../../..')

const NOTIFY_SURFACE = 'host_notifications.notify'

interface Cache {
  data: LanesSnapshot
  fetchedAtMs: number
}

interface CacheState {
  cache: Cache | null
  lastError: string | null
}

function log(msg: string): void {
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

function makeStatusHandler(getState: () => CacheState) {
  return async (): Promise<Record<string, unknown>> => {
    const state = getState()
    if (!state.cache) {
      // No successful poll yet → git was unreadable at boot. Mirrors
      // mesh_introspection's broker_unreachable pre-warm deny.
      throw new MeshDeny('repo_unreadable', {
        last_error: state.lastError ?? 'no_poll_yet',
      })
    }
    const ageMs = Date.now() - state.cache.fetchedAtMs
    return {
      lanes: state.cache.data.lanes,
      fetched_at_ms: state.cache.fetchedAtMs,
      stale: ageMs > STALE_AFTER_MS,
    }
  }
}

async function main(): Promise<void> {
  const secret = process.env.MESH_LANES_SECRET
  if (!secret) {
    process.stderr.write(`[${NODE_ID}] MESH_LANES_SECRET is required; refusing to start.\n`)
    process.exit(2)
  }
  const dataDir = process.env.AETHER_DATA_DIR
  if (!dataDir) {
    process.stderr.write(`[${NODE_ID}] AETHER_DATA_DIR is required; refusing to start.\n`)
    process.exit(2)
  }

  const nodeDir = join(dataDir, NODE_ID)
  mkdirSync(nodeDir, { recursive: true })
  const markerPath = join(nodeDir, 'running')

  const state: CacheState = { cache: null, lastError: null }
  const getState = (): CacheState => state

  const node = new MeshNode(NODE_ID, secret, CORE_URL)
  node.on('status', makeStatusHandler(getState))
  await node.start()
  log(`registered with core at ${CORE_URL}; repo root ${REPO_ROOT}`)

  writeFileSync(markerPath, `${process.pid}\n${new Date().toISOString()}\n`)
  log(`liveness marker written to ${markerPath}`)

  // Previous state per lane PATH, carried across polls. A notification fires only
  // on an OBSERVED active→idle transition: the path must have been seen 'active'
  // on the prior poll. First sight of a lane (no prior entry) never notifies, so
  // a freshly-idle lane discovered at boot stays quiet.
  const prevStates = new Map<string, LaneState>()

  const notifyIdle = async (lane: Lane): Promise<void> => {
    // Fire-and-forget from our perspective: a missing edge, a down notifier, or
    // any invoke failure is logged and swallowed — a notification must never
    // crash the sensor.
    try {
      const resp = await node.invoke(NOTIFY_SURFACE, {
        title: 'Aether',
        body: `Lane idle: ${lane.branch}`,
      })
      if ('kind' in resp && resp.kind === 'error') {
        const reason = typeof resp.payload?.reason === 'string' ? resp.payload.reason : 'unknown'
        log(`notify denied for ${lane.name}: ${reason}`)
      }
    } catch (err) {
      log(`notify failed for ${lane.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const poll = async (): Promise<void> => {
    const result = collectLanes(REPO_ROOT, ACTIVE_WINDOW_MS)
    if (!result.ok) {
      if (state.lastError !== result.error) {
        log(`git read failing: ${result.error}`)
        state.lastError = result.error
      }
      return
    }
    state.cache = { data: result.data, fetchedAtMs: Date.now() }
    if (state.lastError !== null) {
      log(`git read recovered (last error: ${state.lastError})`)
      state.lastError = null
    }

    // Detect active→idle transitions, then refresh the prev-state map.
    const transitions: Lane[] = []
    for (const lane of result.data.lanes) {
      if (prevStates.get(lane.path) === 'active' && lane.state === 'idle') {
        transitions.push(lane)
      }
      prevStates.set(lane.path, lane.state)
    }
    for (const lane of transitions) {
      log(`lane went idle: ${lane.branch}`)
      await notifyIdle(lane)
    }
  }

  // Warm the cache before the first surface invocation, then settle into cadence.
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
