import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode, MeshDeny, type Envelope, type Handler } from '@aether/mesh-node-sdk'
import { SceneClient } from './scene_client'
import {
  renderAgendaPanels,
  renderDashboardPanels,
  renderGapsPanels,
  renderLanesBackdropPanels,
  renderLanesOverlayPanels,
  renderMeshPanels,
} from './templates'
import type {
  AgendaData,
  CalendarResult,
  GapsResult,
  LanesStatus,
  RenderResult,
  ScenePanel,
  Topology,
} from './types'

// The visualizer is a MIXER mesh node: it composes other surfaces
// (mesh_introspection.topology) into a presentation (scene panels). It is the
// ONE bridge from the mesh (data layer) to the RAVEN_AVP scene server
// (presentation layer) — mesh in via node.invoke(), HTTP out via SceneClient.
//
// It exposes a single inbound surface, `render`, which routes an {intent, args}
// envelope to a template function. Adding an intent later = add a template +
// a switch case (the routing is deliberately trivially extensible). Intents:
// 'mesh' (summoned topology overlay), 'dashboard' (always-present backdrop),
// 'lanes' (backdrop + overlay), 'gaps' (summoned gap-log overlay), 'agenda'
// (summoned today/tomorrow calendar overlay).

const NODE_ID = 'visualizer'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'
// Scene server is hardcoded to 127.0.0.1:5180 (no port override upstream); an
// env override is supported here purely for testing flexibility.
const SCENE_SERVER_URL = process.env.AETHER_SCENE_SERVER_URL ?? 'http://127.0.0.1:5180'

const TOPOLOGY_SURFACE = 'mesh_introspection.topology'
const LANES_SURFACE = 'lanes.status'
const GAPS_SURFACE = 'intents.list'
// Newest ~20 gaps is plenty for an at-a-glance "what couldn't Aether do" panel;
// the gap log is low-frequency, so a small cap keeps the overlay readable.
const GAPS_LIMIT = 20
const CALENDAR_TODAY_SURFACE = 'calendar.today'
const CALENDAR_UPCOMING_SURFACE = 'calendar.upcoming'
// Pull a generous upcoming window so the agenda's "tomorrow" section is complete
// — the template filters it down to tomorrow's date. 20 is the node's max.
const AGENDA_UPCOMING_LIMIT = 20
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

// Same mesh-read pattern as fetchTopology, against the lanes sensor. Throws on a
// denied/error envelope or transport failure; renderLanes catches that and still
// renders an "unavailable" panel so the dashboard never goes blank.
async function fetchLanes(node: MeshNode): Promise<LanesStatus> {
  const resp = await node.invoke(LANES_SURFACE, {})
  if (!('kind' in resp)) {
    throw new Error(`${LANES_SURFACE} returned no response envelope`)
  }
  const env = resp as Envelope
  if (env.kind === 'error') {
    const reason = typeof env.payload?.reason === 'string' ? env.payload.reason : 'unknown'
    throw new Error(`${LANES_SURFACE} denied: ${reason}`)
  }
  return env.payload as unknown as LanesStatus
}

// Same mesh-read pattern as fetchLanes, against the gap sensor (intents.list,
// newest ~20 OPEN gaps — the panel shows what Aether still can't do; the closed
// count comes from the response's whole-log `counts`). Throws on a denied/error
// envelope or transport failure (e.g. the intents node killed); renderGaps
// catches that and still renders an "unavailable" panel so a summon never fails
// silently.
async function fetchGaps(node: MeshNode): Promise<GapsResult> {
  const resp = await node.invoke(GAPS_SURFACE, { limit: GAPS_LIMIT, status: 'open' })
  if (!('kind' in resp)) {
    throw new Error(`${GAPS_SURFACE} returned no response envelope`)
  }
  const env = resp as Envelope
  if (env.kind === 'error') {
    const reason = typeof env.payload?.reason === 'string' ? env.payload.reason : 'unknown'
    throw new Error(`${GAPS_SURFACE} denied: ${reason}`)
  }
  return env.payload as unknown as GapsResult
}

// Same mesh-read pattern as fetchGaps, against a calendar surface. The calendar
// node returns { available, events } OR a normal { available:false, reason }
// payload (no_events / permission_denied / framework_unavailable) — those are
// ordinary responses, NOT error envelopes, so they pass through as a
// CalendarResult for the template to render. Only a transport/denied-edge
// failure throws; renderAgenda catches that and renders the section unavailable
// so a summon never fails silently.
async function fetchCalendar(
  node: MeshNode,
  surface: string,
  params: Record<string, unknown>,
): Promise<CalendarResult> {
  const resp = await node.invoke(surface, params)
  if (!('kind' in resp)) {
    throw new Error(`${surface} returned no response envelope`)
  }
  const env = resp as Envelope
  if (env.kind === 'error') {
    const reason = typeof env.payload?.reason === 'string' ? env.payload.reason : 'unknown'
    throw new Error(`${surface} denied: ${reason}`)
  }
  return env.payload as unknown as CalendarResult
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

  // Lanes variant of renderIntent. Distinct from the topology path in ONE way:
  // a failed read does NOT abort — it composes the panel with a null status (an
  // "unavailable" body) and still POSTs it, so dashboard.lanes never disappears
  // when the lanes sensor is down (6.4 resilience standard). Only a scene-server
  // POST failure yields { ok: false }.
  const renderLanes = async (
    intent: string,
    compose: (s: LanesStatus | null) => ScenePanel[],
  ): Promise<RenderResult> => {
    let status: LanesStatus | null = null
    try {
      status = await fetchLanes(node)
    } catch (err) {
      log(`lanes read failed (rendering unavailable): ${errMsg(err)}`)
    }
    const panels = compose(status)
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

  // Gaps variant of the render path. Same resilience contract as renderLanes —
  // a failed read does NOT abort: it composes the overlay with a null result (an
  // "unavailable" body) and still POSTs, so a "show me your gaps" summon degrades
  // gracefully when the intents node is down rather than failing silently. Kept
  // parallel to renderLanes rather than extracted into one helper: two resilient
  // variants don't yet justify a shared abstraction (CLAUDE.md §15 — wait for the
  // third instance).
  const renderGaps = async (
    intent: string,
    compose: (g: GapsResult | null) => ScenePanel[],
  ): Promise<RenderResult> => {
    let gaps: GapsResult | null = null
    try {
      gaps = await fetchGaps(node)
    } catch (err) {
      log(`gaps read failed (rendering unavailable): ${errMsg(err)}`)
    }
    const panels = compose(gaps)
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

  // Agenda variant. UNLIKE the single-surface variants above, it composes TWO
  // calendar surfaces — calendar.today (today's full day) and calendar.upcoming
  // (from which the template carves tomorrow). Each read is independently
  // resilient: a throw on either leaves that section null and the template
  // renders it "unavailable" rather than failing the whole summon (same 6.4
  // resilience standard as renderLanes/renderGaps). Kept as its own function
  // rather than folded into those: the two-surface shape doesn't fit their
  // single-fetch signature, so the §15 "wait for the third instance" extraction
  // wouldn't cleanly cover it anyway.
  const renderAgenda = async (intent: string): Promise<RenderResult> => {
    let today: CalendarResult | null = null
    let upcoming: CalendarResult | null = null
    try {
      today = await fetchCalendar(node, CALENDAR_TODAY_SURFACE, {})
    } catch (err) {
      log(`calendar.today read failed (rendering unavailable): ${errMsg(err)}`)
    }
    try {
      upcoming = await fetchCalendar(node, CALENDAR_UPCOMING_SURFACE, {
        limit: AGENDA_UPCOMING_LIMIT,
      })
    } catch (err) {
      log(`calendar.upcoming read failed (rendering unavailable): ${errMsg(err)}`)
    }
    const data: AgendaData = { today, upcoming }
    const panels = renderAgendaPanels(data)
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
      case 'lanes': {
        const result = await renderLanes('lanes', renderLanesOverlayPanels)
        log(`render('lanes') → ${result.ok ? `posted ${result.panels} panel(s)` : result.error}`)
        return result
      }
      case 'gaps': {
        const result = await renderGaps('gaps', renderGapsPanels)
        log(`render('gaps') → ${result.ok ? `posted ${result.panels} panel(s)` : result.error}`)
        return result
      }
      case 'agenda': {
        const result = await renderAgenda('agenda')
        log(`render('agenda') → ${result.ok ? `posted ${result.panels} panel(s)` : result.error}`)
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
  let lastLanesOk: boolean | null = null
  const refreshDashboard = async (): Promise<void> => {
    const result = await renderIntent('dashboard', renderDashboardPanels)
    if (result.ok && lastOk !== true) {
      log(`dashboard backdrop live (posted ${result.panels} panel(s))`)
      lastOk = true
    } else if (!result.ok && lastOk !== false) {
      log(`dashboard refresh failing: ${result.error}`)
      lastOk = false
    }
    // Third backdrop: dashboard.lanes from the lanes sensor (separate source).
    // renderLanes is resilient — it posts an "unavailable" panel rather than
    // failing when the sensor is down — so this rarely reports !ok (only a
    // scene-server POST failure does).
    const lanesResult = await renderLanes('dashboard.lanes', renderLanesBackdropPanels)
    if (lanesResult.ok && lastLanesOk !== true) {
      log(`lanes backdrop live (posted ${lanesResult.panels} panel(s))`)
      lastLanesOk = true
    } else if (!lanesResult.ok && lastLanesOk !== false) {
      log(`lanes backdrop refresh failing: ${lanesResult.error}`)
      lastLanesOk = false
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
