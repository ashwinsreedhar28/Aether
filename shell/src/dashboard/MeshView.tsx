import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Mesh — the interactive topology graph. The mesh sees itself: nodes and the
// authorization edges between them, sourced from Core's /__introspection__
// endpoint via the mesh_introspection node and polled while this view is
// mounted (LanesView's pattern: poll-on-mount, stop-on-unmount, manual refresh).
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

// ---- Deterministic layout ---------------------------------------------------
// Banded by category, spine first. Positions are a pure function of the node
// SET (sorted by id within each band), so they are stable across refreshes —
// nodes never jitter, and a poll that returns the same nodes returns the same
// coordinates. The SVG uses a fixed viewBox scaled to the container, so window
// size never moves a node either.
const VB_W = 1000
const NODE_R = 20
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

// Curved path between two node centres. The control point is offset along the
// perpendicular of the directed a→b vector, so reciprocal edges (a→b and b→a)
// bow to opposite sides instead of overlapping. Deterministic — same endpoints
// always yield the same curve.
function edgePath(a: Pos, b: Pos): string {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const bow = Math.min(70, len * 0.2)
  const cx = (a.x + b.x) / 2 + nx * bow
  const cy = (a.y + b.y) / 2 + ny * bow
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`
}

function surfaceLabel(e: TopoEdge): string {
  return e.surface ? `${e.to}.${e.surface}` : e.to
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

function DetailPanel({
  node,
  edges,
  onClose,
}: {
  node: TopoNode
  edges: TopoEdge[]
  onClose: () => void
}): React.ReactElement {
  const isSpine = SPINE_IDS.has(node.id)
  // Directed edges touching this node, deduped to their display strings.
  const out = Array.from(new Set(edges.filter((e) => e.from === node.id).map(surfaceLabel))).sort()
  const inbound = Array.from(
    new Set(edges.filter((e) => e.to === node.id).map((e) => (e.surface ? `${e.from} → .${e.surface}` : e.from))),
  ).sort()

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
          out.map((s) => (
            <div key={s} className="text-xs font-mono" style={{ color: 'var(--holo-text)' }}>
              <span style={{ color: 'var(--holo-accent)' }}>→ </span>
              {s}
            </div>
          ))
        )}
      </Section>

      <Section label={`EDGES IN (${inbound.length})`}>
        {inbound.length === 0 ? (
          <Empty />
        ) : (
          inbound.map((s) => (
            <div key={s} className="text-xs font-mono" style={{ color: 'var(--holo-text)' }}>
              {s}
            </div>
          ))
        )}
      </Section>
    </div>
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

// ---- The view ---------------------------------------------------------------

export function MeshView(): React.ReactElement {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
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
  const drawnEdges = useMemo(() => {
    const seen = new Map<string, { from: string; to: string; surfaces: string[] }>()
    for (const e of edges) {
      if (e.from === e.to) continue
      if (!layout.positions.has(e.from) || !layout.positions.has(e.to)) continue
      const key = `${e.from}->${e.to}`
      const ex = seen.get(key)
      if (ex) {
        if (e.surface) ex.surfaces.push(e.surface)
      } else {
        seen.set(key, { from: e.from, to: e.to, surfaces: e.surface ? [e.surface] : [] })
      }
    }
    return Array.from(seen.values())
  }, [edges, layout])

  // Focus = whatever the pointer is over, else the selection. Drives the
  // edge/node highlight. Neighbours of the focus stay lit; everything else dims.
  const focusId = hovered ?? selected
  const neighbours = useMemo(() => {
    if (!focusId) return null
    const set = new Set<string>([focusId])
    for (const e of drawnEdges) {
      if (e.from === focusId) set.add(e.to)
      if (e.to === focusId) set.add(e.from)
    }
    return set
  }, [focusId, drawnEdges])

  // Keep the selection valid: drop it if its node disappears from a refresh.
  useEffect(() => {
    if (selected !== null && !nodeById.has(selected)) setSelected(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  // Esc closes the detail panel.
  useEffect(() => {
    if (selected === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const selectedNode = selected ? (nodeById.get(selected) ?? null) : null
  const stale = payload?.stale === true

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

              {/* Edges (under nodes). */}
              <g fill="none">
                {drawnEdges.map((e) => {
                  const a = layout.positions.get(e.from)
                  const b = layout.positions.get(e.to)
                  if (!a || !b) return null
                  const hot = focusId != null && (e.from === focusId || e.to === focusId)
                  const opacity = focusId == null ? 0.4 : hot ? 0.95 : 0.07
                  return (
                    <path
                      key={`${e.from}->${e.to}`}
                      d={edgePath(a, b)}
                      stroke={hot ? 'var(--holo-accent)' : 'var(--holo-border)'}
                      strokeWidth={hot ? 1.6 : 1}
                      style={{ opacity, transition: 'opacity 120ms ease' }}
                    />
                  )
                })}
              </g>

              {/* Nodes (over edges). */}
              <g>
                {nodes.map((n) => {
                  const p = layout.positions.get(n.id)
                  if (!p) return null
                  const isSel = n.id === selected
                  const isSpine = SPINE_IDS.has(n.id)
                  const running = n.status === 'running'
                  const dim = neighbours != null && !neighbours.has(n.id)
                  const ring = statusColor(n.status)
                  return (
                    <g
                      key={n.id}
                      style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1, transition: 'opacity 120ms ease' }}
                      onClick={(ev) => {
                        ev.stopPropagation()
                        setSelected((cur) => (cur === n.id ? null : n.id))
                      }}
                      onMouseEnter={() => setHovered(n.id)}
                      onMouseLeave={() => setHovered((cur) => (cur === n.id ? null : cur))}
                    >
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={NODE_R}
                        fill={isSpine ? 'rgba(74,158,255,0.10)' : 'var(--holo-panel)'}
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
            </svg>

            <Legend />
          </div>

          {/* Detail panel — only while a node is selected. */}
          {selectedNode && <DetailPanel node={selectedNode} edges={edges} onClose={() => setSelected(null)} />}
        </div>
      )}
    </div>
  )
}
