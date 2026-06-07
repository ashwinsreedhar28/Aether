import { useCallback, useEffect, useRef, useState } from 'react'
import type { SpawnSnapshot, SpawnView } from '../../electron/preload'

// Lanes — an instrument view onto the parallel CC sessions working this repo.
// A "lane" is one git worktree (see CLAUDE.md §13 lanes model). Data comes from
// the lanes sensor node through ONE surface, lanes.status, polled while this
// view is mounted and on demand via the refresh affordance.
//
// CONTRACT (forward-looking). The lanes node returns the base lane fields below.
// Enrichment fields (`last_commit_msg`, `pr`, `agent`) may land in separate
// node lanes — this view must render gracefully whether or not a given
// enrichment has merged, so they are typed optional/nullable and every render
// path degrades to "—" / a subtle note when absent.
//   lanes.status payload: { lanes: Lane[], fetched_at_ms: number, stale: boolean,
//                           gh_available?: boolean }
// Base Lane fields mirror nodes/lanes/src/types.ts. `pr` is a small
// { number, state, url } object so the detail pane can show the number, its
// state, and an openExternal link. `agent` is the live-CC-session signal
// { active, count } — null/absent when the node can't detect processes (lsof
// unavailable), distinct from { active: false } meaning "detected, none here".

interface LanePr {
  number: number
  state?: string
  url?: string
}

interface LaneAgent {
  active: boolean
  count: number
}

interface Lane {
  name: string
  path: string
  branch: string
  is_main: boolean
  dirty_count: number
  last_commit_ms: number | null
  last_activity_ms: number
  state: 'active' | 'idle'
  // Enrichment fields — may be absent until the relevant node lane merges.
  last_commit_msg?: string | null
  pr?: LanePr | null
  // Live CC session signal. null/undefined → detection unavailable.
  agent?: LaneAgent | null
}

interface LanesPayload {
  lanes: Lane[]
  fetched_at_ms?: number
  stale?: boolean
  gh_available?: boolean
}

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; payload: LanesPayload }
  | { kind: 'unavailable'; reason: string }

const POLL_MS = 10_000

// Semantic sidebar order (matches #130 dashboard): main first, then active
// lanes, then idle — each group most-recently-active first. Never alphabetical.
function laneOrder(a: Lane, b: Lane): number {
  if (a.is_main !== b.is_main) return a.is_main ? -1 : 1
  const aActive = a.state === 'active'
  const bActive = b.state === 'active'
  if (aActive !== bActive) return aActive ? -1 : 1
  return b.last_activity_ms - a.last_activity_ms
}

// Compact relative-time for the "active Xm ago" line. Coarse on purpose — this
// is an at-a-glance freshness signal, not a precise clock.
function formatAgo(ms: number): string {
  const delta = Date.now() - ms
  if (delta < 0) return 'just now'
  const sec = Math.floor(delta / 1000)
  if (sec < 45) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

function Dot({ active }: { active: boolean }): React.ReactElement {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        flexShrink: 0,
        background: active ? 'var(--holo-accent)' : 'var(--holo-muted)',
        boxShadow: active ? '0 0 6px var(--holo-glow)' : 'none',
      }}
    />
  )
}

// Live-agent badge: a CC session is attached to this lane. Distinct from the
// state Dot (file-mtime activity) — this is the live-process signal. Accent
// pill with the cockpit's glow language so a working lane reads at a glance.
function AgentTag({ count }: { count: number }): React.ReactElement {
  return (
    <span
      className="text-[9px] tracking-[0.15em] px-1.5 py-0.5 rounded font-mono shrink-0"
      style={{
        color: 'var(--holo-accent)',
        border: '1px solid var(--holo-accent)',
        boxShadow: '0 0 6px var(--holo-glow)',
      }}
      title={`${count} live Claude Code session${count === 1 ? '' : 's'} in this worktree`}
    >
      AGENT{count > 1 ? ` ×${count}` : ''}
    </span>
  )
}

// Detail-pane AGENT value. null/undefined → detection unavailable ("—");
// active → live with session count; else detected-but-none.
function agentValue(agent: LaneAgent | null | undefined): string {
  if (!agent) return '—'
  if (!agent.active) return 'none'
  return `live (${agent.count} session${agent.count === 1 ? '' : 's'})`
}

// Render an enrichment value that may be absent — null/undefined/'' → em dash.
function orDash(v: string | null | undefined): string {
  return v && v.trim() ? v : '—'
}

function DetailPane({
  lane,
  ghAvailable,
}: {
  lane: Lane
  ghAvailable: boolean | undefined
}): React.ReactElement {
  const pr = lane.pr
  return (
    <div className="h-full overflow-y-auto px-5 py-4 space-y-4">
      <div className="flex items-center gap-2">
        <Dot active={lane.state === 'active'} />
        <span className="text-sm font-mono" style={{ color: 'var(--holo-text)' }}>
          {lane.name}
        </span>
        {lane.is_main && (
          <span className="text-[9px] tracking-[0.2em] px-1.5 py-0.5 rounded" style={{ color: 'var(--holo-accent)', border: '1px solid var(--holo-border)' }}>
            MAIN
          </span>
        )}
      </div>

      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-xs font-mono">
        <Field label="BRANCH" value={lane.branch} />
        <Field label="STATE" value={lane.state} accent={lane.state === 'active'} />
        <Field label="AGENT" value={agentValue(lane.agent)} accent={!!lane.agent?.active} />
        <Field label="ACTIVITY" value={`active ${formatAgo(lane.last_activity_ms)}`} />
        <Field label="DIRTY" value={`${lane.dirty_count} file${lane.dirty_count === 1 ? '' : 's'}`} />
        <Field label="LAST COMMIT" value={orDash(lane.last_commit_msg)} />
      </dl>

      {/* PR section. pr may be absent (enrichment not yet merged) → show a dash
          row. gh_available:false → a subtle note that gh couldn't be reached. */}
      <div className="pt-2 border-t" style={{ borderColor: 'var(--holo-border)' }}>
        <div className="text-[10px] tracking-[0.2em] mb-2" style={{ color: 'var(--holo-muted)' }}>
          PULL REQUEST
        </div>
        {pr ? (
          <div className="flex items-center gap-2 text-xs font-mono">
            <span style={{ color: 'var(--holo-text)' }}>#{pr.number}</span>
            <span style={{ color: 'var(--holo-muted)' }}>{orDash(pr.state)}</span>
            {pr.url && (
              <button
                type="button"
                onClick={() => void window.aether.shell.openExternal(pr.url as string)}
                className="text-xs underline underline-offset-2"
                style={{ color: 'var(--holo-accent)', background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                open ↗
              </button>
            )}
          </div>
        ) : (
          <div className="text-xs font-mono" style={{ color: 'var(--holo-muted)' }}>
            —
          </div>
        )}
        {ghAvailable === false && (
          <div className="text-[10px] tracking-widest mt-2" style={{ color: 'var(--holo-muted)', opacity: 0.7 }}>
            PR data unavailable
          </div>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}): React.ReactElement {
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

// Per-status chip colour. requested awaits the Director; spawned is live (glow);
// the terminal states (closed/dismissed/failed) recede.
function spawnChipColor(status: SpawnView['status']): { color: string; glow: boolean } {
  switch (status) {
    case 'requested':
      return { color: 'var(--holo-accent)', glow: false }
    case 'spawned':
      return { color: 'var(--holo-accent)', glow: true }
    default:
      // closed / dismissed / failed — all settled; dim them.
      return { color: 'var(--holo-muted)', glow: false }
  }
}

// A thin strip at the top of the Lanes view reading the spawn ledger — the
// self-build loop's history (requested → spawned → closed / dismissed / failed).
// Hidden entirely when no spawn has ever been recorded. No new tab: the spawn
// actor surfaces here and on the global approval card, nowhere else.
function SpawnsStrip(): React.ReactElement | null {
  const [snap, setSnap] = useState<SpawnSnapshot | null>(null)

  useEffect(() => {
    let alive = true
    void window.aether.spawn.list().then((s) => {
      if (alive) setSnap(s)
    })
    const unsub = window.aether.spawn.onChanged((s) => setSnap(s))
    return () => {
      alive = false
      unsub()
    }
  }, [])

  const spawns = snap?.spawns ?? []
  if (spawns.length === 0) return null

  return (
    <div
      className="shrink-0 px-4 py-2 border-b flex items-center gap-3 overflow-x-auto"
      style={{ borderColor: 'var(--holo-border)' }}
    >
      <span className="text-[10px] tracking-[0.3em] shrink-0" style={{ color: 'var(--holo-muted)' }}>
        SPAWNS
      </span>
      <div className="flex items-center gap-2">
        {spawns.map((s) => {
          const { color, glow } = spawnChipColor(s.status)
          return (
            <span
              key={s.id}
              className="text-[9px] tracking-[0.12em] px-2 py-0.5 rounded font-mono shrink-0 flex items-center gap-1.5"
              style={{
                color,
                border: `1px solid ${color}`,
                boxShadow: glow ? '0 0 6px var(--holo-glow)' : 'none',
              }}
              title={`${s.draftName} · ${s.status}${s.branch ? ` · ${s.branch}` : ''}`}
            >
              <span style={{ color: 'var(--holo-text)' }}>{s.draftName}</span>
              {s.status}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function LanesView(): React.ReactElement {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [selected, setSelected] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Single fetch of lanes.status. Unwraps the mesh envelope; any non-ok result
  // (lanes node down, repo unreadable deny) becomes an 'unavailable' state so
  // the view degrades instead of crashing.
  const fetchLanes = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      const res = await window.aether.mesh.invoke('lanes.status', {})
      if (res.ok && res.envelope) {
        setLoad({ kind: 'ready', payload: res.envelope.payload as unknown as LanesPayload })
      } else {
        setLoad({ kind: 'unavailable', reason: res.error?.message ?? 'lanes node unavailable' })
      }
    } catch (e) {
      setLoad({ kind: 'unavailable', reason: e instanceof Error ? e.message : 'lanes node unavailable' })
    } finally {
      setRefreshing(false)
    }
  }, [])

  // Poll while mounted; stop on unmount. Fetch immediately, then every POLL_MS.
  const fetchRef = useRef(fetchLanes)
  fetchRef.current = fetchLanes
  useEffect(() => {
    void fetchRef.current()
    const interval = setInterval(() => void fetchRef.current(), POLL_MS)
    return () => clearInterval(interval)
  }, [])

  const lanes = load.kind === 'ready' ? [...load.payload.lanes].sort(laneOrder) : []
  const ghAvailable = load.kind === 'ready' ? load.payload.gh_available : undefined

  // Keep a valid selection: preserve the selected name across refreshes when it
  // still exists, else fall back to the first (semantically-ordered) lane.
  useEffect(() => {
    if (lanes.length === 0) {
      if (selected !== null) setSelected(null)
      return
    }
    const first = lanes[0]
    if (first && (selected === null || !lanes.some((l) => l.name === selected))) {
      setSelected(first.name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  const selectedLane = lanes.find((l) => l.name === selected) ?? null

  return (
    <div className="h-full flex flex-col">
      {/* Spawns strip — the self-build ledger, above the lanes proper. Hidden
          until a spawn has been recorded. */}
      <SpawnsStrip />

      {/* Header row: title + manual refresh affordance. */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2">
        <div className="text-xs tracking-[0.3em]" style={{ color: 'var(--holo-muted)' }}>
          LANES
        </div>
        <button
          type="button"
          onClick={() => void fetchLanes()}
          disabled={refreshing}
          className="text-[10px] tracking-[0.2em] flex items-center gap-1"
          style={{ color: 'var(--holo-muted)', background: 'transparent', border: 'none', cursor: refreshing ? 'default' : 'pointer', opacity: refreshing ? 0.5 : 1 }}
          title="Refresh lanes"
        >
          <span style={{ display: 'inline-block' }}>↻</span> REFRESH
        </button>
      </div>

      {load.kind === 'loading' && (
        <div className="flex-1 flex items-center justify-center text-[11px] tracking-widest" style={{ color: 'var(--holo-muted)' }}>
          reading lanes…
        </div>
      )}

      {load.kind === 'unavailable' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <div className="text-[11px] tracking-widest" style={{ color: 'var(--holo-muted)' }}>
            LANES UNAVAILABLE
          </div>
          <div className="text-[10px] tracking-wider" style={{ color: 'var(--holo-muted)', opacity: 0.7 }}>
            {load.reason}
          </div>
        </div>
      )}

      {load.kind === 'ready' && lanes.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-[11px] tracking-widest" style={{ color: 'var(--holo-muted)' }}>
          NO LANES
        </div>
      )}

      {load.kind === 'ready' && lanes.length > 0 && (
        <div className="flex-1 min-h-0 flex">
          {/* Sidebar: one row per lane, semantic order. */}
          <div className="w-56 shrink-0 overflow-y-auto border-r" style={{ borderColor: 'var(--holo-border)' }}>
            {lanes.map((lane) => {
              const isSel = lane.name === selected
              return (
                <button
                  key={lane.name}
                  type="button"
                  onClick={() => setSelected(lane.name)}
                  className="w-full text-left px-3 py-2 flex flex-col gap-1"
                  style={{
                    background: isSel ? 'var(--holo-panel)' : 'transparent',
                    borderLeft: isSel ? '2px solid var(--holo-accent)' : '2px solid transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Dot active={lane.state === 'active'} />
                    <span className="text-xs font-mono truncate min-w-0" style={{ color: 'var(--holo-text)' }} title={lane.name}>
                      {lane.name}
                    </span>
                    {/* Right-aligned metadata: live-agent badge + dirty count.
                        shrink-0 so the badge is never clipped — the name
                        truncates (min-w-0) instead. */}
                    <div className="ml-auto flex items-center gap-1.5 shrink-0">
                      {lane.agent?.active && <AgentTag count={lane.agent.count} />}
                      {lane.dirty_count > 0 && (
                        <span className="text-[10px] font-mono" style={{ color: 'var(--holo-muted)' }} title={`${lane.dirty_count} dirty file(s)`}>
                          {lane.dirty_count}∆
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] font-mono truncate pl-3" style={{ color: 'var(--holo-muted)' }} title={lane.branch}>
                    {lane.branch}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Detail pane. */}
          <div className="flex-1 min-w-0">
            {selectedLane ? (
              <DetailPane lane={selectedLane} ghAvailable={ghAvailable} />
            ) : (
              <div className="h-full flex items-center justify-center text-[11px] tracking-widest" style={{ color: 'var(--holo-muted)' }}>
                SELECT A LANE
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
