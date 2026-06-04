import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Mesh — the interactive topology graph. The mesh sees itself: nodes and the
// authorization edges between them, sourced from Core's /__introspection__
// endpoint via the mesh_introspection node and polled while this view is
// mounted (LanesView's pattern: poll-on-mount, stop-on-unmount, manual refresh).
//
// Edges are first-class here, not just drawn: hover one to read the surface it
// authorizes, click one to inspect the from → to.surface relationship and both
// endpoints' live status, and click an entry in a node's EDGES IN/OUT list to
// jump straight to that edge.
//
// Topology payload (nodes/mesh_introspection makeTopologyHandler, mirroring
// core/core.py handle_introspection):
//   { nodes: TopoNode[], edges: TopoEdge[], stale: boolean, fetched_at_ms: number }
// TopoNode.status is one of running | unhealthy | stopped (see core.py
// _introspection_status); TopoEdge is a directed (from → to.surface) authorization
// edge — multiple surface-edges can connect the same node pair.

interface TopoNode {
  id: string
  category: string
  description: string
  surfaces: string[]
  last_seen_ts: number | null
  status: string
}

interface TopoEdge {
  from: string
  to: string
  surface: string | null
  allowed: boolean
}

interface TopologyPayload {
  nodes: TopoNode[]
  edges: TopoEdge[]
  stale?: boolean
  fetched_at_ms?: number
}

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; payload: TopologyPayload }
  | { kind: 'unavailable'; reason: string }

// What the user is inspecting/pointing at. A node, or one directed edge — a
// from→to pair, which may bundle several surface-edges. Hover uses EdgeRef too.
interface EdgeRef {
  from: string
  to: string
}
type Selection = { kind: 'node'; id: string } | { kind: 'edge'; from: string; to: string }
function sameEdge(a: EdgeRef, b: EdgeRef): boolean {
  return a.from === b.from && a.to === b.to
}
function edgeKey(e: EdgeRef): string {
  return `${e.from}->${e.to}`
}

const POLL_MS = 10_000

// The spine: the always-present backbone of the mesh. `core` is the broker, and
// shell + raven are the two Mixers that everything routes around. Grouped by id
// (not category — all three are Mixers) so they read as one band.
const SPINE_IDS = new Set(['core', 'raven', 'shell'])

// Status → dot colour. running/stopped mirror the cockpit's binary dot language
// (accent+glow vs muted). `unhealthy` (Core saw the node 90–300s ago but it is
// not connected) is real state the binary language can't honestly show, so it
// gets one restrained amber — the only non-CSS-var colour in this view.
const UNHEALTHY_COLOR = '#d6a24a'
function statusColor(status: string): string {
  if (status === 'running') return 'var(--holo-accent)'
  if (status === 'unhealthy') return UNHEALTHY_COLOR
  return 'var(--holo-muted)'
}

// ---- Category identity ------------------------------------------------------
// Category is the structural signal: it drives node SHAPE (always, regardless of
// status) and node HUE (the running-state border tint). Classification mirrors
// BAND_DEFS — spine wins over its Mixer category so the backbone reads as one
// family. `other` catches any category Core emits outside the known set.
type CatKey = 'spine' | 'mixer' | 'sensor' | 'actor' | 'other'
function categoryKey(n: TopoNode): CatKey {
  if (SPINE_IDS.has(n.id)) return 'spine'
  if (n.category === 'Mixer') return 'mixer'
  if (n.category === 'Sensor') return 'sensor'
  if (n.category === 'Actor') return 'actor'
  return 'other'
}

// Muted category hues — a restrained family beside the accent blue. Only the
// 1px border and the running-status tint carry these; fills stay neutral (see
// node render) so the view never saturates. Spine and the `other` fallback
// reuse the theme accent, so the backbone never drifts from --holo-accent.
// Local constants, not theme vars: the mesh view is the only consumer today
// (§15 — no premature abstraction; extract on the third instance).
const CATEGORY_HUE: Record<CatKey, string> = {
  spine: 'var(--holo-accent)',
  sensor: '#3fbeac', // teal
  actor: '#ef8270', // coral
  mixer: '#9d86e4', // violet
  other: 'var(--holo-accent)',
}

// ---- Deterministic layout ---------------------------------------------------
// Banded by category, spine first. Positions are a pure function of the node
// SET (sorted by id within each band), so they are stable across refreshes —
// nodes never jitter, and a poll that returns the same nodes returns the same
// coordinates. The SVG uses a fixed viewBox scaled to the container, so window
// size never moves a node either.
const VB_W = 1000
const NODE_R = 20
// Per-shape sizes, tuned to roughly equal visual weight to the sensor circle so
// the bands stay even. Spine is deliberately larger — the backbone should read
// heavier. All stay well inside X_STEP/ROW_H, so layout and labels don't move.
const HEX_R = 22 // mixer hexagon circumradius
const ACTOR_S = 34 // actor rounded-square side
const SPINE_W = 56 // spine rounded-rect width (wider than a node)
const SPINE_H = 40 // spine rounded-rect height
const MAX_PER_ROW = 5
const ROW_H = 132
const BAND_GAP = 40
const TOP_PAD = 60
const BOTTOM_PAD = 52
const X_STEP = 156

interface BandDef {
  key: string
  label: string
  match: (n: TopoNode) => boolean
}

// First match wins; the trailing `other` band catches anything Core categorises
// outside the known set so no node is ever silently dropped from the graph.
const BAND_DEFS: BandDef[] = [
  { key: 'spine', label: 'SPINE', match: (n) => SPINE_IDS.has(n.id) },
  { key: 'mixer', label: 'MIXER', match: (n) => n.category === 'Mixer' },
  { key: 'sensor', label: 'SENSOR', match: (n) => n.category === 'Sensor' },
  { key: 'actor', label: 'ACTOR', match: (n) => n.category === 'Actor' },
  { key: 'other', label: 'OTHER', match: () => true },
]

interface Pos {
  x: number
  y: number
}
interface BandLabel {
  label: string
  y: number
}
interface Layout {
  positions: Map<string, Pos>
  bands: BandLabel[]
  height: number
}

function computeLayout(nodes: TopoNode[]): Layout {
  const byBand = new Map<string, TopoNode[]>()
  for (const n of nodes) {
    const def = BAND_DEFS.find((b) => b.match(n))
    const key = def ? def.key : 'other'
    const arr = byBand.get(key)
    if (arr) arr.push(n)
    else byBand.set(key, [n])
  }

  const positions = new Map<string, Pos>()
  const bands: BandLabel[] = []
  let y = TOP_PAD

  for (const def of BAND_DEFS) {
    const group = byBand.get(def.key)
    if (!group || group.length === 0) continue
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id))
    const firstRowY = y
    for (let r = 0; r < sorted.length; r += MAX_PER_ROW) {
      const row = sorted.slice(r, r + MAX_PER_ROW)
      const rowWidth = (row.length - 1) * X_STEP
      const startX = VB_W / 2 - rowWidth / 2
      row.forEach((n, i) => positions.set(n.id, { x: startX + i * X_STEP, y }))
      y += ROW_H
    }
    bands.push({ label: def.label, y: (firstRowY + (y - ROW_H)) / 2 })
    y += BAND_GAP
  }

  const height = Math.max(y - BAND_GAP + BOTTOM_PAD, 320)
  return { positions, bands, height }
}

// Control point for the curve between two node centres. Offset along the
// perpendicular of the directed a→b vector, so reciprocal edges (a→b and b→a)
// bow to opposite sides instead of overlapping. Deterministic — same endpoints
// always yield the same curve.
function controlPoint(a: Pos, b: Pos): Pos {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const bow = Math.min(70, len * 0.2)
  return { x: (a.x + b.x) / 2 + nx * bow, y: (a.y + b.y) / 2 + ny * bow }
}

function edgePath(a: Pos, b: Pos): string {
  const c = controlPoint(a, b)
  return `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`
}

// Midpoint of the quadratic curve (t = 0.5) — where the hover label sits.
function edgeMid(a: Pos, b: Pos): Pos {
  const c = controlPoint(a, b)
  return { x: 0.25 * a.x + 0.5 * c.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * c.y + 0.25 * b.y }
}

function surfaceLabel(e: TopoEdge): string {
  return e.surface ? `${e.to}.${e.surface}` : e.to
}

// A directed edge as drawn: one path per node pair, carrying every surface that
// rides it. Built in MeshView; consumed by the graph and the hover label.
interface DrawnEdge {
  from: string
  to: string
  surfaces: string[]
}

// Compact label for a drawn edge's surface(s): `to.surface`, with `+N` when the
// pair carries more than one. A bare authorization (no surface) reads as `to`.
function edgeSurfaceLabel(e: DrawnEdge): string {
  const uniq = Array.from(new Set(e.surfaces))
  if (uniq.length === 0) return e.to
  if (uniq.length === 1) return `${e.to}.${uniq[0]}`
  return `${e.to}.${uniq[0]} +${uniq.length - 1}`
}

// ---- Small shared bits ------------------------------------------------------

function StatusDot({ status }: { status: string }): React.ReactElement {
  const running = status === 'running'
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        flexShrink: 0,
        background: statusColor(status),
        boxShadow: running ? '0 0 6px var(--holo-glow)' : 'none',
      }}
    />
  )
}

// A row in a detail panel that selects something on click. Local hover state so
// the highlight survives the 10s poll re-render (an inline-mutated style would
// reset to transparent on every refresh).
function RowButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
}): React.ReactElement {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      className="w-full text-left rounded px-1 -mx-1 py-0.5 transition-colors"
      style={{ background: hover ? 'var(--holo-bg)' : 'transparent', border: 'none', cursor: 'pointer', color: 'inherit' }}
    >
      {children}
    </button>
  )
}

// One clickable EDGES IN/OUT entry: a display label plus the from→to pair it
// belongs to, so a click can select that edge.
interface EdgeRow {
  key: string
  label: string
  ref: EdgeRef
}

// Outbound rows for a node: one per `to.surface` display string (matching the
// prior list verbatim), each carrying the from→to pair it selects.
function outRows(node: TopoNode, edges: TopoEdge[]): EdgeRow[] {
  const m = new Map<string, EdgeRow>()
  for (const e of edges) {
    if (e.from !== node.id) continue
    const label = surfaceLabel(e)
    if (!m.has(label)) m.set(label, { key: label, label, ref: { from: node.id, to: e.to } })
  }
  return Array.from(m.values()).sort((a, b) => a.label.localeCompare(b.label))
}

// Inbound rows: mirror of outRows, keyed on the `from → .surface` display form.
function inRows(node: TopoNode, edges: TopoEdge[]): EdgeRow[] {
  const m = new Map<string, EdgeRow>()
  for (const e of edges) {
    if (e.to !== node.id) continue
    const label = e.surface ? `${e.from} → .${e.surface}` : e.from
    if (!m.has(label)) m.set(label, { key: label, label, ref: { from: e.from, to: node.id } })
  }
  return Array.from(m.values()).sort((a, b) => a.label.localeCompare(b.label))
}

function DetailPanel({
  node,
  edges,
  onClose,
  onSelectEdge,
}: {
  node: TopoNode
  edges: TopoEdge[]
  onClose: () => void
  onSelectEdge: (e: EdgeRef) => void
}): React.ReactElement {
  const isSpine = SPINE_IDS.has(node.id)
  const out = outRows(node, edges)
  const inbound = inRows(node, edges)

  return (
    <div
      className="w-72 shrink-0 border-l h-full overflow-y-auto px-5 py-4 space-y-4"
      style={{ borderColor: 'var(--holo-border)', background: 'var(--holo-panel)' }}
    >
      <div className="flex items-center gap-2">
        <StatusDot status={node.status} />
        <span className="text-sm font-mono break-all" style={{ color: 'var(--holo-text)' }}>
          {node.id}
        </span>
        {isSpine && (
          <span
            className="text-[9px] tracking-[0.2em] px-1.5 py-0.5 rounded"
            style={{ color: 'var(--holo-accent)', border: '1px solid var(--holo-border)' }}
          >
            SPINE
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-xs"
          style={{ color: 'var(--holo-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-2 text-xs font-mono">
        <Field label="STATUS" value={node.status} accent={node.status === 'running'} />
        <Field label="CATEGORY" value={node.category || '—'} />
      </dl>

      {node.description && (
        <div className="text-[11px] leading-relaxed" style={{ color: 'var(--holo-muted)' }}>
          {node.description}
        </div>
      )}

      <Section label={`SURFACES (${node.surfaces.length})`}>
        {node.surfaces.length === 0 ? (
          <Empty />
        ) : (
          node.surfaces.map((s) => (
            <div key={s} className="text-xs font-mono" style={{ color: 'var(--holo-text)' }}>
              {s}
            </div>
          ))
        )}
      </Section>

      <Section label={`EDGES OUT (${out.length})`}>
        {out.length === 0 ? (
          <Empty />
        ) : (
          out.map((row) => (
            <RowButton key={row.key} onClick={() => onSelectEdge(row.ref)} title={`Inspect edge → ${row.label}`}>
              <span className="text-xs font-mono" style={{ color: 'var(--holo-text)' }}>
                <span style={{ color: 'var(--holo-accent)' }}>→ </span>
                {row.label}
              </span>
            </RowButton>
          ))
        )}
      </Section>

      <Section label={`EDGES IN (${inbound.length})`}>
        {inbound.length === 0 ? (
          <Empty />
        ) : (
          inbound.map((row) => (
            <RowButton key={row.key} onClick={() => onSelectEdge(row.ref)} title={`Inspect edge ${row.label}`}>
              <span className="text-xs font-mono" style={{ color: 'var(--holo-text)' }}>
                {row.label}
              </span>
            </RowButton>
          ))
        )}
      </Section>
    </div>
  )
}

// Edge inspector — opens when an edge is selected (clicked in the graph or from
// a node's EDGES IN/OUT list). Shows the authorized relationship for every
// surface on the pair, plus both endpoints' live status; endpoints are
// clickable to jump back to the node, closing the navigation loop.
function EdgeDetailPanel({
  from,
  to,
  edges,
  onClose,
  onSelectNode,
}: {
  from: TopoNode
  to: TopoNode
  edges: TopoEdge[]
  onClose: () => void
  onSelectNode: (id: string) => void
}): React.ReactElement {
  const surfaces = Array.from(
    new Set(edges.filter((e) => e.from === from.id && e.to === to.id && e.surface).map((e) => e.surface as string)),
  ).sort()

  return (
    <div
      className="w-72 shrink-0 border-l h-full overflow-y-auto px-5 py-4 space-y-4"
      style={{ borderColor: 'var(--holo-border)', background: 'var(--holo-panel)' }}
    >
      <div className="flex items-center gap-2">
        <span
          className="text-[9px] tracking-[0.2em] px-1.5 py-0.5 rounded shrink-0"
          style={{ color: 'var(--holo-accent)', border: '1px solid var(--holo-border)' }}
        >
          EDGE
        </span>
        <span className="text-sm font-mono break-all" style={{ color: 'var(--holo-text)' }}>
          {from.id} <span style={{ color: 'var(--holo-accent)' }}>→</span> {to.id}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-xs"
          style={{ color: 'var(--holo-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      <Section label={surfaces.length > 0 ? `RELATIONSHIP (${surfaces.length})` : 'RELATIONSHIP'}>
        {surfaces.length === 0 ? (
          <div className="text-xs font-mono" style={{ color: 'var(--holo-text)' }}>
            <span style={{ color: 'var(--holo-muted)' }}>{from.id} </span>
            <span style={{ color: 'var(--holo-accent)' }}>→ </span>
            {to.id}
            <span style={{ color: 'var(--holo-muted)' }}> · no surface</span>
          </div>
        ) : (
          surfaces.map((s) => (
            <div key={s} className="text-xs font-mono break-all" style={{ color: 'var(--holo-text)' }}>
              <span style={{ color: 'var(--holo-muted)' }}>{from.id} </span>
              <span style={{ color: 'var(--holo-accent)' }}>→ </span>
              {to.id}.{s}
            </div>
          ))
        )}
      </Section>

      <Section label="ENDPOINTS">
        <EndpointRow role="FROM" node={from} onSelect={onSelectNode} />
        <EndpointRow role="TO" node={to} onSelect={onSelectNode} />
      </Section>
    </div>
  )
}

function EndpointRow({
  role,
  node,
  onSelect,
}: {
  role: string
  node: TopoNode
  onSelect: (id: string) => void
}): React.ReactElement {
  const running = node.status === 'running'
  return (
    <RowButton onClick={() => onSelect(node.id)} title={`Inspect ${node.id}`}>
      <span className="flex items-center gap-2">
        <span className="text-[9px] tracking-[0.15em] w-9 shrink-0" style={{ color: 'var(--holo-muted)' }}>
          {role}
        </span>
        <StatusDot status={node.status} />
        <span className="text-xs font-mono break-all" style={{ color: 'var(--holo-text)' }}>
          {node.id}
        </span>
        <span
          className="ml-auto text-[10px] font-mono"
          style={{ color: running ? 'var(--holo-accent)' : 'var(--holo-muted)' }}
        >
          {node.status}
        </span>
      </span>
    </RowButton>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="pt-2 border-t" style={{ borderColor: 'var(--holo-border)' }}>
      <div className="text-[10px] tracking-[0.2em] mb-2" style={{ color: 'var(--holo-muted)' }}>
        {label}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Empty(): React.ReactElement {
  return (
    <div className="text-xs font-mono" style={{ color: 'var(--holo-muted)' }}>
      —
    </div>
  )
}

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }): React.ReactElement {
  return (
    <>
      <dt className="text-[10px] tracking-[0.15em] self-center" style={{ color: 'var(--holo-muted)' }}>
        {label}
      </dt>
      <dd className="break-words" style={{ color: accent ? 'var(--holo-accent)' : 'var(--holo-text)' }}>
        {value}
      </dd>
    </>
  )
}

function Legend(): React.ReactElement {
  const items: { label: string; status: string }[] = [
    { label: 'running', status: 'running' },
    { label: 'unhealthy', status: 'unhealthy' },
    { label: 'stopped', status: 'stopped' },
  ]
  return (
    <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 pointer-events-none" style={{ opacity: 0.7 }}>
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2">
          <StatusDot status={it.status} />
          <span className="text-[9px] tracking-[0.15em]" style={{ color: 'var(--holo-muted)' }}>
            {it.label.toUpperCase()}
          </span>
        </div>
      ))}
    </div>
  )
}

// Pointy-top regular hexagon, first vertex straight up. Deterministic — same
// centre always yields the same points string.
function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90)
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`)
  }
  return pts.join(' ')
}

// A node's body, shaped by category. Sensor → circle, Actor → rounded square,
// Mixer → hexagon, spine → larger rounded rect. Every variant is centred on
// (cx, cy) and sized near NODE_R, so the label offset, layout, and the <g>'s
// hit region are unchanged. fill/stroke/strokeWidth/style pass straight through
// (the running-glow filter applies to any shape identically).
function NodeShape({
  cat,
  cx,
  cy,
  fill,
  stroke,
  strokeWidth,
  style,
}: {
  cat: CatKey
  cx: number
  cy: number
  fill: string
  stroke: string
  strokeWidth: number
  style?: React.CSSProperties
}): React.ReactElement {
  const common = { fill, stroke, strokeWidth, style }
  if (cat === 'spine') {
    return <rect x={cx - SPINE_W / 2} y={cy - SPINE_H / 2} width={SPINE_W} height={SPINE_H} rx={10} {...common} />
  }
  if (cat === 'actor') {
    return <rect x={cx - ACTOR_S / 2} y={cy - ACTOR_S / 2} width={ACTOR_S} height={ACTOR_S} rx={7} {...common} />
  }
  if (cat === 'mixer') {
    return <polygon points={hexPoints(cx, cy, HEX_R)} {...common} />
  }
  // sensor and the `other` fallback both render as the canonical circle.
  return <circle cx={cx} cy={cy} r={NODE_R} {...common} />
}

// ---- The view ---------------------------------------------------------------

export function MeshView(): React.ReactElement {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [selected, setSelected] = useState<Selection | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<EdgeRef | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Single fetch of mesh_introspection.topology. Any non-ok result (node down,
  // broker unreachable, edge denied) becomes 'unavailable' so the view degrades
  // instead of crashing.
  const fetchTopology = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      const res = await window.aether.mesh.invoke('mesh_introspection.topology', {})
      if (res.ok && res.envelope) {
        setLoad({ kind: 'ready', payload: res.envelope.payload as unknown as TopologyPayload })
      } else {
        setLoad({ kind: 'unavailable', reason: res.error?.message ?? 'mesh introspection unavailable' })
      }
    } catch (e) {
      setLoad({ kind: 'unavailable', reason: e instanceof Error ? e.message : 'mesh introspection unavailable' })
    } finally {
      setRefreshing(false)
    }
  }, [])

  // Poll while mounted; stop on unmount. Fetch immediately, then every POLL_MS.
  const fetchRef = useRef(fetchTopology)
  fetchRef.current = fetchTopology
  useEffect(() => {
    void fetchRef.current()
    const interval = setInterval(() => void fetchRef.current(), POLL_MS)
    return () => clearInterval(interval)
  }, [])

  const payload = load.kind === 'ready' ? load.payload : null
  const nodes = useMemo<TopoNode[]>(() => (Array.isArray(payload?.nodes) ? payload.nodes : []), [payload])
  const edges = useMemo<TopoEdge[]>(() => (Array.isArray(payload?.edges) ? payload.edges : []), [payload])
  const layout = useMemo(() => computeLayout(nodes), [nodes])
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  // Deduplicate directed edges to one path per node pair; collect every surface
  // riding that pair for the tooltip. Drop edges whose endpoints aren't laid out.
  const drawnEdges = useMemo<DrawnEdge[]>(() => {
    const seen = new Map<string, DrawnEdge>()
    for (const e of edges) {
      if (e.from === e.to) continue
      if (!layout.positions.has(e.from) || !layout.positions.has(e.to)) continue
      const key = edgeKey(e)
      const ex = seen.get(key)
      if (ex) {
        if (e.surface) ex.surfaces.push(e.surface)
      } else {
        seen.set(key, { from: e.from, to: e.to, surfaces: e.surface ? [e.surface] : [] })
      }
    }
    return Array.from(seen.values())
  }, [edges, layout])

  const selectNode = useCallback((id: string): void => {
    setSelected((cur) => (cur?.kind === 'node' && cur.id === id ? null : { kind: 'node', id }))
  }, [])
  const selectEdge = useCallback((e: EdgeRef): void => {
    setSelected((cur) => (cur?.kind === 'edge' && sameEdge(cur, e) ? null : { kind: 'edge', from: e.from, to: e.to }))
  }, [])

  // Focus = whatever the pointer is over (an edge wins, then a node), else the
  // selection. Drives the highlight: the focused node's neighbours stay lit, or
  // a focused edge's two endpoints do; everything else dims.
  const focus = useMemo<Selection | null>(() => {
    if (hoveredEdge) return { kind: 'edge', from: hoveredEdge.from, to: hoveredEdge.to }
    if (hoveredNode) return { kind: 'node', id: hoveredNode }
    return selected
  }, [hoveredEdge, hoveredNode, selected])

  const litNodes = useMemo<Set<string> | null>(() => {
    if (!focus) return null
    if (focus.kind === 'edge') return new Set<string>([focus.from, focus.to])
    const set = new Set<string>([focus.id])
    for (const e of drawnEdges) {
      if (e.from === focus.id) set.add(e.to)
      if (e.to === focus.id) set.add(e.from)
    }
    return set
  }, [focus, drawnEdges])

  // Keep the selection valid across refreshes: drop a node selection if its node
  // disappears, and an edge selection if either endpoint disappears. A node
  // merely changing status (e.g. killed → stopped) keeps the selection so the
  // panel reflects the new status live.
  useEffect(() => {
    if (selected === null) return
    if (selected.kind === 'node' && !nodeById.has(selected.id)) setSelected(null)
    else if (selected.kind === 'edge' && (!nodeById.has(selected.from) || !nodeById.has(selected.to)))
      setSelected(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  // Esc closes the detail panel (node or edge).
  useEffect(() => {
    if (selected === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  // Resolve the current selection to live node objects for whichever panel shows.
  const detail = useMemo(() => {
    if (!selected) return null
    if (selected.kind === 'node') {
      const node = nodeById.get(selected.id)
      return node ? { kind: 'node' as const, node } : null
    }
    const from = nodeById.get(selected.from)
    const to = nodeById.get(selected.to)
    return from && to ? { kind: 'edge' as const, from, to } : null
  }, [selected, nodeById])

  // Inline surface label for the hovered edge, drawn at its curve midpoint.
  const hoverLabel = useMemo(() => {
    if (!hoveredEdge) return null
    const a = layout.positions.get(hoveredEdge.from)
    const b = layout.positions.get(hoveredEdge.to)
    if (!a || !b) return null
    const de = drawnEdges.find((e) => sameEdge(e, hoveredEdge))
    if (!de) return null
    const m = edgeMid(a, b)
    return { x: m.x, y: m.y, text: edgeSurfaceLabel(de) }
  }, [hoveredEdge, layout, drawnEdges])

  const stale = payload?.stale === true
  const focusEdge = focus?.kind === 'edge' ? focus : null
  const focusNodeId = focus?.kind === 'node' ? focus.id : null

  return (
    <div className="h-full flex flex-col">
      {/* Header: title · counts · stale · refresh. */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2">
        <div className="flex items-baseline gap-3">
          <span className="text-xs tracking-[0.3em]" style={{ color: 'var(--holo-muted)' }}>
            MESH TOPOLOGY
          </span>
          {load.kind === 'ready' && (
            <span className="text-[10px] font-mono tracking-wider" style={{ color: 'var(--holo-muted)' }}>
              <span style={{ color: 'var(--holo-accent)' }}>{nodes.length}</span> nodes
              {' · '}
              <span style={{ color: 'var(--holo-accent)' }}>{edges.length}</span> edges
              {stale && <span style={{ color: UNHEALTHY_COLOR }}> · stale</span>}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void fetchTopology()}
          disabled={refreshing}
          className="text-[10px] tracking-[0.2em] flex items-center gap-1"
          style={{
            color: 'var(--holo-muted)',
            background: 'transparent',
            border: 'none',
            cursor: refreshing ? 'default' : 'pointer',
            opacity: refreshing ? 0.5 : 1,
          }}
          title="Refresh topology"
        >
          <span style={{ display: 'inline-block' }}>↻</span> REFRESH
        </button>
      </div>

      {load.kind === 'loading' && (
        <div className="flex-1 flex items-center justify-center text-[11px] tracking-widest" style={{ color: 'var(--holo-muted)' }}>
          reading topology…
        </div>
      )}

      {load.kind === 'unavailable' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <div className="text-[11px] tracking-widest" style={{ color: 'var(--holo-muted)' }}>
            TOPOLOGY UNAVAILABLE
          </div>
          <div className="text-[10px] tracking-wider" style={{ color: 'var(--holo-muted)', opacity: 0.7 }}>
            {load.reason}
          </div>
        </div>
      )}

      {load.kind === 'ready' && nodes.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-[11px] tracking-widest" style={{ color: 'var(--holo-muted)' }}>
          NO NODES
        </div>
      )}

      {load.kind === 'ready' && nodes.length > 0 && (
        <div className="flex-1 min-h-0 flex">
          {/* Graph area. */}
          <div className="flex-1 min-w-0 relative">
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox={`0 0 ${VB_W} ${layout.height}`}
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Background catcher — click empty space to deselect. */}
              <rect x={0} y={0} width={VB_W} height={layout.height} fill="transparent" onClick={() => setSelected(null)} />

              {/* Band labels, far left, vertically centred on each band. */}
              {layout.bands.map((b) => (
                <text
                  key={b.label}
                  x={24}
                  y={b.y}
                  dominantBaseline="middle"
                  style={{ fill: 'var(--holo-muted)', fontSize: 10, letterSpacing: 3, opacity: 0.6 }}
                >
                  {b.label}
                </text>
              ))}

              {/* Edges (under nodes). Each is a visible curve plus a wide,
                  transparent hit path that catches hover/click — thin strokes
                  are nearly impossible to point at. */}
              <g fill="none">
                {drawnEdges.map((e) => {
                  const a = layout.positions.get(e.from)
                  const b = layout.positions.get(e.to)
                  if (!a || !b) return null
                  const d = edgePath(a, b)
                  const hot = focusEdge
                    ? sameEdge(e, focusEdge)
                    : focusNodeId != null && (e.from === focusNodeId || e.to === focusNodeId)
                  // Resting edges carry their source node's category tint at low
                  // opacity; the #161 focus accent still wins when hot.
                  const opacity = focus == null ? 0.22 : hot ? 0.95 : 0.07
                  const src = nodeById.get(e.from)
                  const tint = src ? CATEGORY_HUE[categoryKey(src)] : 'var(--holo-border)'
                  return (
                    <g key={edgeKey(e)}>
                      <path
                        d={d}
                        stroke={hot ? 'var(--holo-accent)' : tint}
                        strokeWidth={hot ? 1.6 : 1}
                        pointerEvents="none"
                        style={{ opacity, transition: 'opacity 120ms ease' }}
                      />
                      <path
                        d={d}
                        stroke="transparent"
                        strokeWidth={14}
                        pointerEvents="stroke"
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setHoveredEdge({ from: e.from, to: e.to })}
                        onMouseLeave={() => setHoveredEdge((cur) => (cur && sameEdge(cur, e) ? null : cur))}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          selectEdge({ from: e.from, to: e.to })
                        }}
                      />
                    </g>
                  )
                })}
              </g>

              {/* Nodes (over edges). */}
              <g>
                {nodes.map((n) => {
                  const p = layout.positions.get(n.id)
                  if (!p) return null
                  const isSel = selected?.kind === 'node' && selected.id === n.id
                  const cat = categoryKey(n)
                  const running = n.status === 'running'
                  const dim = litNodes != null && !litNodes.has(n.id)
                  // Border tracks status first so kill/unhealthy stay honest; a
                  // running node wears its category hue, making category read
                  // without ever saturating the fill.
                  const ring =
                    n.status === 'unhealthy'
                      ? UNHEALTHY_COLOR
                      : running
                        ? CATEGORY_HUE[cat]
                        : 'var(--holo-muted)'
                  return (
                    <g
                      key={n.id}
                      style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1, transition: 'opacity 120ms ease' }}
                      onClick={(ev) => {
                        ev.stopPropagation()
                        selectNode(n.id)
                      }}
                      onMouseEnter={() => setHoveredNode(n.id)}
                      onMouseLeave={() => setHoveredNode((cur) => (cur === n.id ? null : cur))}
                    >
                      <NodeShape
                        cat={cat}
                        cx={p.x}
                        cy={p.y}
                        fill="var(--holo-panel)"
                        stroke={ring}
                        strokeWidth={isSel ? 2.6 : 1.4}
                        style={{
                          filter: running
                            ? `drop-shadow(0 0 ${isSel ? 9 : 5}px var(--holo-glow))`
                            : isSel
                              ? `drop-shadow(0 0 6px ${ring})`
                              : 'none',
                        }}
                      />
                      <text
                        x={p.x}
                        y={p.y + NODE_R + 16}
                        textAnchor="middle"
                        style={{
                          fill: running ? 'var(--holo-text)' : 'var(--holo-muted)',
                          fontSize: 11,
                          fontFamily: 'ui-monospace, monospace',
                        }}
                      >
                        {n.id}
                      </text>
                    </g>
                  )
                })}
              </g>

              {/* Hovered-edge surface label, on top. The stroke halo (painted
                  behind the fill) keeps it legible over lines and nodes. */}
              {hoverLabel && (
                <text
                  x={hoverLabel.x}
                  y={hoverLabel.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  pointerEvents="none"
                  style={{
                    fill: 'var(--holo-accent)',
                    stroke: 'var(--holo-bg)',
                    strokeWidth: 4,
                    paintOrder: 'stroke',
                    fontSize: 11,
                    letterSpacing: 0.5,
                    fontFamily: 'ui-monospace, monospace',
                  }}
                >
                  {hoverLabel.text}
                </text>
              )}
            </svg>

            <Legend />
          </div>

          {/* Detail panel — node or edge, depending on the selection. */}
          {detail?.kind === 'node' && (
            <DetailPanel node={detail.node} edges={edges} onClose={() => setSelected(null)} onSelectEdge={selectEdge} />
          )}
          {detail?.kind === 'edge' && (
            <EdgeDetailPanel
              from={detail.from}
              to={detail.to}
              edges={edges}
              onClose={() => setSelected(null)}
              onSelectNode={selectNode}
            />
          )}
        </div>
      )}
    </div>
  )
}
