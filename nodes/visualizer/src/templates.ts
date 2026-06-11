import type {
  LaneInfo,
  LanesStatus,
  MeshNodeInfo,
  ScenePanel,
  Topology,
  Transform,
} from './types'

// Pure panel composition. Each function turns a mesh `Topology` snapshot into a
// list of SceneDoc panels; it performs NO I/O (no mesh reads, no scene POSTs) —
// index.ts reads the topology and ships the panels. Keeping these pure makes
// the markdown-shaping logic trivially testable and side-effect-free.
//
// v1 DECISION (lane spec): all panels are `markdown` kind. The macOS shell's
// iframe sandbox is sandbox="" (no scripts) per Sprint 6.3b, so a graphical
// inline-SVG mesh visualization would be blocked. A markdown structured-text
// representation renders cleanly under that sandbox and ships a working
// diagnostic surface today; the graphical mesh viz is a deferred fast-follow
// for once a sandbox-relaxation policy exists.

// Stable backdrop ids (dashboard.* namespace convention): re-POSTed every ~5s
// to the merge endpoint so they update in place. A future curation lane uses
// this prefix to distinguish always-present backdrop from summoned overlay.
export const PANEL_MESH_HEALTH = 'dashboard.mesh-health'
export const PANEL_RAVEN_STATUS = 'dashboard.raven-status'
// Transient summoned overlay (non-dashboard id → marks it as not-backdrop).
export const PANEL_MESH_OVERLAY = 'viz-mesh'
// Lanes: a third always-present backdrop (dashboard.*) + a summoned overlay.
export const PANEL_LANES_BACKDROP = 'dashboard.lanes'
export const PANEL_LANES_OVERLAY = 'viz-lanes'

// Canonical four-category vocabulary order (roadmap architectural anchor #1).
// Semantic ordering, not alphabetical (CLAUDE.md §11.1).
const CATEGORY_ORDER = ['Sensor', 'Actor', 'Mixer', 'Planner']

const ZERO3: [number, number, number] = [0, 0, 0]
const ONE3: [number, number, number] = [1, 1, 1]

// 2D dashboard ignores position (arrival-order column layout, Sprint 6.3b
// Q3=C); these coordinates exist for the 3D AVP shell (Sprint 17) and mirror
// the seed-scene convention (y≈1.5, z≈-1.3, x spreads panels apart).
function transformAt(x: number, y = 1.5, z = -1.3): Transform {
  return { position: [x, y, z], rotation: ZERO3, scale: ONE3 }
}

function makeMarkdownPanel(
  id: string,
  text: string,
  transform: Transform,
  size: { width: number; height: number },
  panelTag: string,
): ScenePanel {
  return {
    id,
    kind: 'markdown',
    text,
    transform,
    size,
    // String values only (governance-log 2026-05-26); coerceStyle enforces it
    // again at POST time. `panel` lets a future curation lane group by role.
    style: { source: 'visualizer', panel: panelTag },
  }
}

function formatAge(ms: number): string {
  if (ms < 0) return 'just now'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.round(m / 60)}h`
}

// The broker's last_seen_ts unit isn't pinned in the introspection contract;
// normalize to epoch-ms. A value below ~1e12 is epoch-seconds (1e12 ms is
// year 2001, far in the past — anything smaller can't be a recent ms timestamp).
function toEpochMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts
}

// Shared freshness footer for any cache-then-serve surface (topology, lanes).
// `label` names what was fetched so the line reads naturally per panel.
function freshnessFrom(stale: boolean | undefined, fetchedAtMs: number | undefined, label: string): string {
  const parts: string[] = []
  if (stale) parts.push('⚠ data is stale')
  if (typeof fetchedAtMs === 'number') {
    parts.push(`${label} fetched ${formatAge(Date.now() - fetchedAtMs)} ago`)
  }
  return parts.length > 0 ? parts.join(' · ') : 'freshness unknown'
}

function freshnessLine(t: Topology): string {
  return freshnessFrom(t.stale, t.fetched_at_ms, 'topology')
}

// Categories present, ordered by the canonical vocabulary then any extras
// alphabetically.
function orderedCategories(nodes: MeshNodeInfo[]): string[] {
  const present = new Set(nodes.map((n) => n.category || 'uncategorized'))
  const known = CATEGORY_ORDER.filter((c) => present.has(c))
  const extra = [...present].filter((c) => !CATEGORY_ORDER.includes(c)).sort()
  return [...known, ...extra]
}

function nodesIn(nodes: MeshNodeInfo[], category: string): MeshNodeInfo[] {
  return nodes
    .filter((n) => (n.category || 'uncategorized') === category)
    .sort((a, b) => a.id.localeCompare(b.id))
}

// ── dashboard.* backdrop panels ───────────────────────────────────────────────

function meshHealthMarkdown(t: Topology): string {
  const nodes = t.nodes ?? []
  const edges = t.edges ?? []
  const cats = orderedCategories(nodes)

  const byCategory = cats
    .map((c) => `- ${c}: ${nodesIn(nodes, c).length}`)
    .join('\n')

  // Group by the broker's status string verbatim — avoids hardcoding an enum
  // we haven't pinned. Whatever the broker reports ('online'/'offline'/…) is
  // counted and shown as-is.
  const statusCounts = new Map<string, number>()
  for (const n of nodes) {
    const s = n.status || 'unknown'
    statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1)
  }
  const byStatus = [...statusCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([s, n]) => `- ${s}: ${n}`)
    .join('\n')

  return [
    '## Mesh Health',
    '',
    `**${nodes.length} nodes** · ${cats.length} categories · ${edges.length} edges`,
    '',
    '**By category**',
    byCategory || '- (none)',
    '',
    '**By status**',
    byStatus || '- (none)',
    '',
    `_${freshnessLine(t)}_`,
  ].join('\n')
}

function ravenStatusMarkdown(t: Topology): string {
  const nodes = t.nodes ?? []
  const raven = nodes.find((n) => n.id === 'raven')
  if (!raven) {
    return ['## Voice (raven)', '', '_not registered_', '', `_${freshnessLine(t)}_`].join('\n')
  }
  const surfaces = raven.surfaces?.length ?? 0
  const ts = raven.last_seen_ts
  const lastSeen =
    typeof ts === 'number' ? `last seen ${formatAge(Date.now() - toEpochMs(ts))} ago` : 'never seen'
  return [
    '## Voice (raven)',
    '',
    `**${raven.status || 'unknown'}** · ${surfaces} surface${surfaces === 1 ? '' : 's'}`,
    '',
    `_${lastSeen} · ${freshnessLine(t)}_`,
  ].join('\n')
}

// Composes the two always-present backdrop panels. Seeded on boot and re-POSTed
// on the ~5s cadence (merge endpoint) so the backdrop stays live.
export function renderDashboardPanels(t: Topology): ScenePanel[] {
  return [
    makeMarkdownPanel(
      PANEL_MESH_HEALTH,
      meshHealthMarkdown(t),
      transformAt(-0.55),
      { width: 0.5, height: 0.4 },
      'mesh-health',
    ),
    makeMarkdownPanel(
      PANEL_RAVEN_STATUS,
      ravenStatusMarkdown(t),
      transformAt(0.55),
      { width: 0.5, height: 0.3 },
      'raven-status',
    ),
  ]
}

// ── 'mesh' summoned overlay ───────────────────────────────────────────────────

function edgeLine(e: { from: string; to: string; surface: string; allowed: boolean }): string {
  // Broker edges carry both `to` and `surface`; the manifest declares them as
  // `to: node.surface`. Render `from → node.surface` whether or not `to`
  // already includes the surface segment. Denied edges are marked.
  const target = e.surface && !e.to.includes('.') ? `${e.to}.${e.surface}` : e.to
  return `- ${e.from} → ${target}${e.allowed === false ? ' ⊘ (denied)' : ''}`
}

function meshOverlayMarkdown(t: Topology): string {
  const nodes = t.nodes ?? []
  const edges = t.edges ?? []
  const cats = orderedCategories(nodes)

  const nodeSections = cats
    .map((c) => {
      const lines = nodesIn(nodes, c).map((n) => {
        const surfaces = n.surfaces?.length ?? 0
        return `- **${n.id}** — ${n.status || 'unknown'} · ${surfaces} surface${surfaces === 1 ? '' : 's'}`
      })
      return [`### ${c}`, ...lines].join('\n')
    })
    .join('\n\n')

  const edgeLines = edges.map(edgeLine).join('\n')

  return [
    '# Mesh Topology',
    '',
    `${nodes.length} nodes · ${edges.length} edges`,
    '',
    '## Nodes by category',
    '',
    nodeSections || '_no nodes_',
    '',
    '## Edges',
    '',
    edgeLines || '_no edges_',
    '',
    `_${freshnessLine(t)}_`,
  ].join('\n')
}

// Composes the summoned mesh-topology overlay (a single panel, stable id so a
// repeat "show me the mesh" updates it in place rather than stacking copies).
export function renderMeshPanels(t: Topology): ScenePanel[] {
  return [
    makeMarkdownPanel(
      PANEL_MESH_OVERLAY,
      meshOverlayMarkdown(t),
      transformAt(0, 1.2),
      { width: 0.7, height: 0.5 },
      'mesh-overlay',
    ),
  ]
}

// ── 'lanes' — backdrop + summoned overlay ─────────────────────────────────────

// Semantic ordering (CLAUDE.md §11.1), NOT alphabetical: the main lane first
// (the canonical checkout), then active lanes ahead of idle ones, then most
// recently active first within each group. This puts "who's working right now"
// at the top of the panel where the eye lands.
function laneSortKey(a: LaneInfo, b: LaneInfo): number {
  if (a.is_main !== b.is_main) return a.is_main ? -1 : 1
  const aActive = a.state === 'active'
  const bActive = b.state === 'active'
  if (aActive !== bActive) return aActive ? -1 : 1
  return b.last_activity_ms - a.last_activity_ms
}

function laneLine(lane: LaneInfo): string {
  const state = lane.state === 'active' ? '**ACTIVE**' : 'idle'
  const dirty = `${lane.dirty_count} dirty`
  const ago = `active ${formatAge(Date.now() - lane.last_activity_ms)} ago`
  const mainTag = lane.is_main ? ' · main' : ''
  return `- **${lane.name}** \`${lane.branch}\` — ${state} · ${dirty} · ${ago}${mainTag}`
}

// `status` is nullable on purpose: when the lanes sensor is unavailable the
// visualizer still renders this panel (with an explicit unavailable note) rather
// than dropping it — the dashboard must NEVER go blank on a missing dependency
// (6.4 resilience standard).
function lanesMarkdown(status: LanesStatus | null): string {
  if (!status) {
    return ['## Lanes', '', '_lanes sensor unavailable_'].join('\n')
  }
  const lanes = [...(status.lanes ?? [])].sort(laneSortKey)
  const active = lanes.filter((l) => l.state === 'active').length
  const lines = lanes.map(laneLine)
  return [
    '## Lanes',
    '',
    `**${lanes.length} lane${lanes.length === 1 ? '' : 's'}** · ${active} active`,
    '',
    lines.join('\n') || '- (no worktrees)',
    '',
    `_${freshnessFrom(status.stale, status.fetched_at_ms, 'lanes')}_`,
  ].join('\n')
}

// Third always-present backdrop panel (dashboard.* id → re-POSTed in place on
// the ~5s loop alongside mesh-health + raven-status). x=1.65 continues the 1.1
// spacing of the existing two backdrops (-0.55, 0.55).
export function renderLanesBackdropPanels(status: LanesStatus | null): ScenePanel[] {
  return [
    makeMarkdownPanel(
      PANEL_LANES_BACKDROP,
      lanesMarkdown(status),
      transformAt(1.65),
      { width: 0.5, height: 0.4 },
      'lanes',
    ),
  ]
}

// Summoned lanes overlay (stable viz-lanes id; a repeat summon updates in place).
export function renderLanesOverlayPanels(status: LanesStatus | null): ScenePanel[] {
  return [
    makeMarkdownPanel(
      PANEL_LANES_OVERLAY,
      lanesMarkdown(status),
      transformAt(0, 1.2),
      { width: 0.7, height: 0.5 },
      'lanes-overlay',
    ),
  ]
}

// ── 'agenda' summoned overlay ─────────────────────────────────────────────────
// Self-contained region (own type import below) so it rebases cleanly against
// the parallel lifecycle lane, which edits the regions above.

import type { AgendaData, CalendarEvent, CalendarResult } from './types'

// Summoned overlay only (no backdrop — the agenda is summoned on demand, not an
// always-present dashboard fixture). Stable non-dashboard id so a repeat "show
// me my agenda" updates it in place rather than stacking copies.
export const PANEL_AGENDA_OVERLAY = 'viz-agenda'

// Deterministic weekday/month labels — avoids toLocale* locale variance across
// machines (the panel must read the same on the dev Mac and the collaborator's).
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dayLabel(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

// Local Y-M-D key for a Date built from LOCAL getters (NOT toISOString, which is
// UTC). Used only for "now" / "tomorrow" — genuine local Date objects from
// `new Date()`. Event date keys come from eventDateKey (literal parse) instead.
function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Parse the calendar node's local-naive ISO stamp (e.g. "2026-06-05T10:00:00")
// into its LITERAL wall-clock components, ignoring any trailing offset/Z.
// Deliberately NOT `new Date(iso)`: the JS engine guesses a zone for an
// offset-less string (UTC vs local varies by engine and by how the daemon
// process is spawned — that is the 3-hours-off panel bug), and getHours() then
// shifts the shown time. The node already emits system-local wall-clock, so we
// render the components verbatim — the same approach as the Python spoken path
// (datetime.fromisoformat → strftime, which also reads components literally).
function parseLocalIso(
  iso: string,
): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)
  if (!m) return null
  // Groups 1-5 are guaranteed present when the regex matches; destructure +
  // Number() rather than +m[i] so noUncheckedIndexedAccess is satisfied without
  // per-field guards.
  const [, year, month, day, hour, minute] = m
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  }
}

// Local calendar-day key for an EVENT, from its literal ISO date components —
// TZ-invariant (see parseLocalIso). Empty string for an unparseable stamp so it
// never collides with a real tomorrow key. Exported for the isolated time check.
export function eventDateKey(iso: string): string {
  const p = parseLocalIso(iso)
  if (!p) return ''
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

// 12-hour wall-clock label from the event's literal components — TZ-invariant
// (see parseLocalIso). Exported for the isolated time check.
export function formatEventTime(iso: string): string {
  const p = parseLocalIso(iso)
  if (!p) return 'time unknown'
  let h = p.hour
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${String(p.minute).padStart(2, '0')} ${ampm}`
}

function eventLine(e: CalendarEvent): string {
  const time = e.is_all_day ? 'all day' : formatEventTime(e.start)
  const title = e.title || 'Untitled'
  const loc = e.location ? ` · ${e.location}` : ''
  return `- **${time}** — ${title}${loc}`
}

// A non-null "blocking" reason means the section can't show events at all
// (unavailable / denied) — distinct from 'no_events', which renders as the
// friendlier empty label by the caller. null → there's nothing blocking, fall
// through to the event list (or the empty label).
function blockingNote(result: CalendarResult | null): string | null {
  if (result === null) return 'calendar unavailable'
  if (result.available) return null
  switch (result.reason) {
    case 'no_events':
      return null
    case 'permission_denied':
      return 'calendar access not authorized'
    case 'framework_unavailable':
      return 'calendar unavailable on this platform'
    default:
      return 'calendar unavailable'
  }
}

function eventsByStart(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => a.start.localeCompare(b.start))
}

function agendaSection(
  heading: string,
  result: CalendarResult | null,
  events: CalendarEvent[],
  emptyLabel: string,
): string[] {
  const note = blockingNote(result)
  if (note) return [heading, '', `_${note}_`]
  if (events.length === 0) return [heading, '', `_${emptyLabel}_`]
  return [heading, '', ...eventsByStart(events).map(eventLine)]
}

function agendaMarkdown(data: AgendaData): string {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowKey = localDateKey(tomorrow)

  // Today: every event the node returned for today's full day (midnight→midnight).
  const todayEvents =
    data.today && data.today.available ? data.today.events ?? [] : []

  // Tomorrow: carved out of the upcoming window by local date. upcoming starts
  // at "now", so it never includes today's earlier events — exactly the slice we
  // want once today is sourced separately above. Beyond-tomorrow events drop out.
  // Match on the event's LITERAL date key (eventDateKey) so the bucketing is
  // TZ-invariant — same reason formatEventTime avoids new Date().
  const upcomingEvents =
    data.upcoming && data.upcoming.available ? data.upcoming.events ?? [] : []
  const tomorrowEvents = upcomingEvents.filter((e) => eventDateKey(e.start) === tomorrowKey)

  return [
    '# Agenda',
    '',
    ...agendaSection(`## Today — ${dayLabel(now)}`, data.today, todayEvents, 'No events today'),
    '',
    ...agendaSection(
      `## Tomorrow — ${dayLabel(tomorrow)}`,
      data.upcoming,
      tomorrowEvents,
      'No events tomorrow',
    ),
  ].join('\n')
}

// Summoned agenda overlay (stable viz-agenda id; a repeat summon updates in
// place). Same single-panel shape as the mesh/lanes overlays.
export function renderAgendaPanels(data: AgendaData): ScenePanel[] {
  return [
    makeMarkdownPanel(
      PANEL_AGENDA_OVERLAY,
      agendaMarkdown(data),
      transformAt(0, 1.2),
      { width: 0.7, height: 0.5 },
      'agenda-overlay',
    ),
  ]
}
