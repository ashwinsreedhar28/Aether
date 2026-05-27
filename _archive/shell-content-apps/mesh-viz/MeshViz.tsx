import { useState } from 'react'
import type { ReactElement } from 'react'
import { useMeshIntrospection } from './useMeshIntrospection'
import { RadialLayout } from './RadialLayout'
import { ActivityFeed } from './ActivityFeed'
import './styles.css'

/**
 * Top-level mesh-viz surface: a radial topology graph (left, flex-1) beside a
 * live activity feed (right, fixed 280px). The single data source is
 * useMeshIntrospection() — a 2s poll of the signed mesh surfaces with
 * keep-last semantics. This component owns only view state (showCore, hover).
 */
export function MeshViz(): ReactElement {
  const { topology, activity, lastSuccessAt, error } = useMeshIntrospection()
  const [showCore, setShowCore] = useState(true)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)

  const neverLoaded = topology === null
  // First poll failed and none has ever succeeded → hard-unreachable.
  const unreachable = neverLoaded && lastSuccessAt === null && error !== null
  // First poll still in flight (no payload, no error yet).
  const loading = neverLoaded && error === null
  const stale = Boolean(topology?.stale || activity?.stale)

  return (
    <div className="h-full w-full flex" style={{ color: 'var(--holo-text)' }}>
      <div className="flex-1 flex flex-col min-w-0">
        <div
          className="flex items-center gap-4 px-4 h-10 shrink-0 border-b"
          style={{ borderColor: 'var(--holo-border)', background: 'rgba(10,10,15,0.4)' }}
        >
          <span className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--holo-muted)' }}>
            Mesh Topology
          </span>
          <label
            className="flex items-center gap-2 text-xs cursor-pointer select-none"
            style={{ color: 'var(--holo-muted)' }}
          >
            <input
              type="checkbox"
              checked={showCore}
              onChange={(e) => setShowCore(e.target.checked)}
              style={{ accentColor: 'var(--holo-accent)' }}
            />
            Show core
          </label>
          {stale && (
            <span className="mesh-stale-banner text-[10px] uppercase tracking-[0.14em] px-2 py-1 rounded">
              snapshot stale
            </span>
          )}
        </div>
        <div className="flex-1 relative min-h-0">
          {unreachable ? (
            <div className="mesh-fallback">Mesh introspection unreachable</div>
          ) : loading ? (
            <div className="mesh-fallback">Loading mesh topology…</div>
          ) : topology ? (
            <RadialLayout
              topology={topology}
              hoveredNodeId={hoveredNodeId}
              onHoverChange={setHoveredNodeId}
              showCore={showCore}
            />
          ) : null}
        </div>
      </div>
      <ActivityFeed activity={activity} topology={topology} />
    </div>
  )
}
