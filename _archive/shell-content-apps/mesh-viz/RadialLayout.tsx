import type { ReactElement } from 'react'
import type { NodeCategory, TopologyNode, TopologyPayload } from './types'
import { CORE_NODE_ID } from './types'
import { NodeSymbol } from './NodeSymbol'
import { EdgeLayer, type NodePos } from './EdgeLayer'

// Strategy A: one ring around Core, nodes grouped into category sectors. With
// a Sensor-heavy fleet (the current 16-node mesh), a single ring uses the
// canvas more evenly than concentric rings-per-category (Strategy B), which
// would leave the inner Planner/Actor rings nearly empty. See PR Open Qs.
const VIEWBOX = 1000
const CENTER = VIEWBOX / 2
const OUTER_R = 350
const LABEL_OFFSET = 22 // radial gap from node centre to its label anchor

// Sector order around the ring (clockwise from top). Sensors lead since they
// are the majority; Planner trails as the not-yet-populated placeholder.
const CATEGORY_RANK: Record<NodeCategory, number> = {
  Sensor: 0,
  Mixer: 1,
  Actor: 2,
  Planner: 3
}

interface RadialLayoutProps {
  topology: TopologyPayload
  hoveredNodeId: string | null
  onHoverChange: (id: string | null) => void
  showCore: boolean
}

interface LaidNode {
  node: TopologyNode
  x: number
  y: number
  isCore: boolean
  labelX: number
  labelY: number
  labelAnchor: 'start' | 'middle' | 'end'
}

function rankOf(category: string): number {
  return (CATEGORY_RANK as Record<string, number>)[category] ?? 99
}

export function RadialLayout({ topology, hoveredNodeId, onHoverChange, showCore }: RadialLayoutProps): ReactElement {
  const coreNode = topology.nodes.find((n) => n.id === CORE_NODE_ID) ?? null
  const ringNodes = topology.nodes.filter((n) => n.id !== CORE_NODE_ID)

  // Primary sort by category sector (semantic); intra-sector tiebreak is
  // alphabetical by id — nodes carry no inherent order key, so a stable
  // deterministic placement is the best available (flagged in PR §11.1).
  const sorted = [...ringNodes].sort((a, b) => rankOf(a.category) - rankOf(b.category) || a.id.localeCompare(b.id))

  const positions = new Map<string, NodePos>()
  const laid: LaidNode[] = []

  sorted.forEach((node, i) => {
    // Even angular step around the full circle, starting at top (-90°). Because
    // the list is category-sorted, each category occupies a contiguous arc
    // whose size is proportional to its node count — Strategy A's "sectors".
    const angle = -Math.PI / 2 + (sorted.length === 0 ? 0 : (i / sorted.length) * 2 * Math.PI)
    const x = CENTER + OUTER_R * Math.cos(angle)
    const y = CENTER + OUTER_R * Math.sin(angle)
    positions.set(node.id, { x, y, category: node.category })

    const lr = OUTER_R + LABEL_OFFSET
    const cos = Math.cos(angle)
    const labelAnchor: LaidNode['labelAnchor'] = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle'
    laid.push({
      node,
      x,
      y,
      isCore: false,
      labelX: CENTER + lr * cos,
      labelY: CENTER + lr * Math.sin(angle),
      labelAnchor
    })
  })

  // Core: always dead centre, only when toggled on. Its position is added to
  // the map only when shown, so EdgeLayer's missing-endpoint guard also drops
  // core-incident edges (belt-and-suspenders with its own showCore filter).
  if (showCore && coreNode) {
    positions.set(CORE_NODE_ID, { x: CENTER, y: CENTER, category: 'core' })
    laid.push({
      node: coreNode,
      x: CENTER,
      y: CENTER,
      isCore: true,
      labelX: CENTER,
      labelY: CENTER + 42, // below the (larger) core glyph
      labelAnchor: 'middle'
    })
  }

  return (
    <svg
      className="mesh-svg"
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Mesh topology graph"
    >
      <EdgeLayer edges={topology.edges} nodePositions={positions} hoveredNodeId={hoveredNodeId} showCore={showCore} />
      {laid.map((item) => (
        <NodeSymbol
          key={item.node.id}
          node={item.node}
          x={item.x}
          y={item.y}
          isCore={item.isCore}
          labelX={item.labelX}
          labelY={item.labelY}
          labelAnchor={item.labelAnchor}
          isHovered={hoveredNodeId === item.node.id}
          dimmed={hoveredNodeId !== null && hoveredNodeId !== item.node.id}
          onHoverChange={onHoverChange}
        />
      ))}
    </svg>
  )
}
