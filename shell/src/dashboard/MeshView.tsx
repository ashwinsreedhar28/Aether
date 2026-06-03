import { useEffect, useState } from 'react'

// Minimal mesh stub: one line of prose plus live node/edge counts pulled once
// from the mesh_introspection node. The full interactive topology graph is the
// NEXT lane — this view deliberately stays a single fetch + count readout and
// leaves a clean mounting point (the GRAPH MOUNT POINT marker below) for it.
//
// Topology payload shape (nodes/mesh_introspection makeTopologyHandler):
//   { nodes: unknown[], edges: unknown[], stale: boolean, fetched_at_ms: number }
// We only consume the two array lengths here.
type Counts = { nodes: number; edges: number }

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; counts: Counts }
  | { kind: 'unavailable'; reason: string }

export function MeshView(): React.ReactElement {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })

  useEffect(() => {
    let active = true
    void window.aether.mesh
      .invoke('mesh_introspection.topology', {})
      .then((res) => {
        if (!active) return
        if (res.ok && res.envelope) {
          const p = res.envelope.payload as { nodes?: unknown[]; edges?: unknown[] }
          setLoad({
            kind: 'ready',
            counts: {
              nodes: Array.isArray(p.nodes) ? p.nodes.length : 0,
              edges: Array.isArray(p.edges) ? p.edges.length : 0,
            },
          })
        } else {
          setLoad({ kind: 'unavailable', reason: res.error?.message ?? 'mesh unavailable' })
        }
      })
      .catch((e: unknown) => {
        if (active) setLoad({ kind: 'unavailable', reason: e instanceof Error ? e.message : 'mesh unavailable' })
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 select-none">
      <div className="text-xs tracking-[0.3em]" style={{ color: 'var(--holo-muted)' }}>
        MESH TOPOLOGY
      </div>

      {load.kind === 'loading' && (
        <div className="text-[11px] tracking-widest" style={{ color: 'var(--holo-muted)', opacity: 0.6 }}>
          reading topology…
        </div>
      )}

      {load.kind === 'ready' && (
        <div className="text-sm font-mono tracking-wider" style={{ color: 'var(--holo-text)' }}>
          <span style={{ color: 'var(--holo-accent)' }}>{load.counts.nodes}</span> nodes
          {' · '}
          <span style={{ color: 'var(--holo-accent)' }}>{load.counts.edges}</span> edges
        </div>
      )}

      {load.kind === 'unavailable' && (
        <div className="text-[11px] tracking-widest" style={{ color: 'var(--holo-muted)', opacity: 0.7 }}>
          topology unavailable — {load.reason}
        </div>
      )}

      <div className="text-[10px] tracking-widest" style={{ color: 'var(--holo-muted)', opacity: 0.5 }}>
        interactive graph — next lane
      </div>

      {/* GRAPH MOUNT POINT — the next lane renders the full node/edge graph here,
          fed by the same mesh_introspection.topology payload. */}
    </div>
  )
}
