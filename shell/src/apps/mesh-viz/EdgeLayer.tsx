import type { ReactElement } from 'react'
import type { TopologyEdge } from './types'
import { CORE_NODE_ID } from './types'
import { styleFor } from './palette'

/**
 * A laid-out node: its canvas coords plus the category used to colour edges
 * that originate from it. Built by RadialLayout (the only place that knows
 * positions) and threaded down to both the edge layer and the node layer.
 */
export interface NodePos {
  x: number
  y: number
  /** Category string off the wire, or `'core'` for the dispatch host. */
  category: string
}

interface EdgeLayerProps {
  edges: TopologyEdge[]
  nodePositions: Map<string, NodePos>
  hoveredNodeId: string | null
  showCore: boolean
}

interface AggregatedEdge {
  from: string
  to: string
  /** Number of per-surface edges collapsed into this one line (Choice Y). */
  surfaces: number
}

// Edges off the wire are PER-SURFACE (types.ts TopologyEdge). We render
// Choice Y: one line per directed (from→to) pair, width scaled by the number
// of surfaces, rather than Choice X's fan of curves. Simpler and legible at
// 16 nodes; revisit if a pair ever carries enough surfaces to need the fan.
function aggregate(edges: TopologyEdge[], positions: Map<string, NodePos>, showCore: boolean): AggregatedEdge[] {
  const byPair = new Map<string, AggregatedEdge>()
  for (const e of edges) {
    if (!showCore && (e.from === CORE_NODE_ID || e.to === CORE_NODE_ID)) continue
    // Skip dangling edges — an endpoint the layout didn't place can't be drawn.
    if (!positions.has(e.from) || !positions.has(e.to)) continue
    const key = `${e.from}->${e.to}`
    const cur = byPair.get(key)
    if (cur) cur.surfaces += 1
    else byPair.set(key, { from: e.from, to: e.to, surfaces: 1 })
  }
  return [...byPair.values()]
}

export function EdgeLayer({ edges, nodePositions, hoveredNodeId, showCore }: EdgeLayerProps): ReactElement {
  const pairs = aggregate(edges, nodePositions, showCore)
  const touches = (p: AggregatedEdge): boolean =>
    hoveredNodeId !== null && (p.from === hoveredNodeId || p.to === hoveredNodeId)

  // Paint untouched edges first so a hovered node's edges sit on top.
  const ordered = [...pairs].sort((a, b) => Number(touches(a)) - Number(touches(b)))

  return (
    <g>
      {ordered.map((p) => {
        const a = nodePositions.get(p.from)!
        const b = nodePositions.get(p.to)!
        const touched = touches(p)
        const dimmed = hoveredNodeId !== null && !touched
        const opacity = touched ? 0.8 : dimmed ? 0.12 : 0.4
        // Surface count drives base width; hover overrides to a fixed emphasis.
        const baseWidth = Math.min(1.5 + (p.surfaces - 1) * 0.5, 4)
        const width = touched ? 2.5 : baseWidth
        return (
          <line
            key={`${p.from}->${p.to}`}
            className="mesh-edge"
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={styleFor(a.category).fill}
            strokeOpacity={opacity}
            strokeWidth={width}
            strokeLinecap="round"
          />
        )
      })}
    </g>
  )
}
