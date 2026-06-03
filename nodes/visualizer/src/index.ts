import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode, MeshDeny, type Envelope, type Handler } from '@aether/mesh-node-sdk'
import { SceneClient } from './scene_client'
import { renderDashboardPanels, renderMeshPanels } from './templates'
import type { RenderResult, ScenePanel, Topology } from './types'

// The visualizer is a MIXER mesh node: it composes other surfaces
// (mesh_introspection.topology) into a presentation (scene panels). It is the
// ONE bridge from the mesh (data layer) to the RAVEN_AVP scene server
// (presentation layer) — mesh in via node.invoke(), HTTP out via SceneClient.
//
// It exposes a single inbound surface, `render`, which routes an {intent, args}
// envelope to a template function. Adding an intent later = add a template +
// a switch case (the routing is deliberately trivially extensible). v1 intents
// are 'mesh' (summoned overlay) and 'dashboard' (always-present backdrop) only.

const NODE_ID = 'visualizer'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'
// Scene server is hardcoded to 127.0.0.1:5180 (no port override upstream); an
// env override is supported here purely for testing flexibility.
const SCENE_SERVER_URL = process.env.AETHER_SCENE_SERVER_URL ?? 'http://127.0.0.1:5180'

const TOPOLOGY_SURFACE = 'mesh_introspection.topology'
// Re-POST the dashboard backdrop on this cadence so it stays live. Uses the
// merge endpoint (via upsert) so re-POSTs update in place — no 409 storm.
const DASHBOARD_INTERVAL_MS = 5_000

function log(msg: string): void {
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// Reads mesh state through the mesh (NOT the broker's admin endpoint directly):
// node.invoke() → Core /v0/invoke → mesh_introspection.topology. node.invoke
// resolves to the response Envelope; a kind:'error' envelope means the target
// denied (e.g. broker_unreachable before its cache warms), and a transport/edge
// failure throws MeshError. Both surface here as a thrown Error for the caller.
async function fetchTopology(node: MeshNode): Promise<Topology> {
  const resp = await node.invoke(TOPOLOGY_SURFACE, {})
  if (!('kind' in resp)) {
    // request_response should always yield a full envelope; an accepted-only
    // shape is unexpected for this surface — treat as a failure to read.
    throw new Error(`${TOPOLOGY_SURFACE} returned no response envelope`)
  }
  const env = resp as Envelope
  if (env.kind === 'error') {
    const reason = typeof env.payload?.reason === 'string' ? env.payload.reason : 'unknown'
    throw new Error(`${TOPOLOGY_SURFACE} denied: ${reason}`)
  }
  return env.payload as unknown as Topology
}

async function main(): Promise<void> {
  const secret = process.env.MESH_VISUALIZER_SECRET
  if (!secret) {
    process.stderr.write(`[${NODE_ID}] MESH_VISUALIZER_SECRET is required; refusing to start.\n`)
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

  const node = new MeshNode(NODE_ID, secret, CORE_URL)
  const scene = new SceneClient(SCENE_SERVER_URL, log)

  // Read topology → compose panels → upsert each to the scene server. Returns
  // the surface contract { ok } shape; never throws (callers decide logging).
  // upsertPanel merges existing ids in place and appends new ones, so the same
  // call works for both the first seed and every refresh.
  const renderIntent = async (
    intent: string,
    compose: (t: Topology) => ScenePanel[],
  ): Promise<RenderResult> => {
    let topology: Topology
    try {
      topology = await fetchTopology(node)
    } catch (err) {
      return { ok: false, intent, error: `topology_read_failed: ${errMsg(err)}` }
    }
    const panels = compose(topology)
    let posted = 0
    const failures: string[] = []
    for (const panel of panels) {
      const res = await scene.upsertPanel(panel)
      if (res.ok) posted += 1
      else failures.push(`${panel.id}: ${res.error ?? res.status ?? 'unknown'}`)
    }
    if (posted === 0 && failures.length > 0) {
      return { ok: false, intent, error: `scene_post_failed: ${failures.join('; ')}` }
    }
    return { ok: true, intent, panels: posted }
  }

  // The single inbound surface. {intent, args} arrives in the envelope payload;
  // route via switch. Unknown intent is a request-level rejection → MeshDeny
  // (distinct from a downstream failure, which returns { ok: false }).
  const renderHandler: Handler = async (env: Envelope) => {
    const intent = typeof env.payload?.intent === 'string' ? env.payload.intent : undefined
    switch (intent) {
      case 'mesh': {
        const result = await renderIntent('mesh', renderMeshPanels)
        log(`render('mesh') → ${result.ok ? `posted ${result.panels} panel(s)` : result.error}`)
        return result
      }
      case 'dashboard': {
        const result = await renderIntent('dashboard', renderDashboardPanels)
        log(`render('dashboard') → ${result.ok ? `posted ${result.panels} panel(s)` : result.error}`)
        return result
      }
      default:
        throw new MeshDeny('unknown_intent', { intent: intent ?? null })
    }
  }

  node.on('render', renderHandler)
  await node.start()
  log(`registered with core at ${CORE_URL}; scene server ${SCENE_SERVER_URL}`)

  writeFileSync(markerPath, `${process.pid}\n${new Date().toISOString()}\n`)
  log(`liveness marker written to ${markerPath}`)

  // Keep the dashboard.* backdrop live. Re-POST on a cadence; log only on state
  // transitions so a persistently-down dependency (introspection cold, scene
  // server killed) doesn't spam the log. Resilient by construction: a failed
  // cycle is logged and skipped, and the next tick retries.
  let lastOk: boolean | null = null
  const refreshDashboard = async (): Promise<void> => {
    const result = await renderIntent('dashboard', renderDashboardPanels)
    if (result.ok && lastOk !== true) {
      log(`dashboard backdrop live (posted ${result.panels} panel(s))`)
      lastOk = true
    } else if (!result.ok && lastOk !== false) {
      log(`dashboard refresh failing: ${result.error}`)
      lastOk = false
    }
  }

  // Seed once on boot (awaited), then settle into the cadence. The boot seed
  // may fail if mesh_introspection hasn't registered/warmed yet (nodes spawn in
  // parallel) — that's fine, the interval retries.
  await refreshDashboard()
  const timer = setInterval(() => {
    void refreshDashboard()
  }, DASHBOARD_INTERVAL_MS)

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
