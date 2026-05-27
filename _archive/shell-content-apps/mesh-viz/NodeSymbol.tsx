import type { ReactElement } from 'react'
import type { TopologyNode } from './types'
import { opacityFor, styleFor } from './palette'

// Symbol vocabulary (lane 108a). Sizes are SVG user units in the 1000-unit
// viewBox; they scale with the canvas. Kept here (not in palette.ts) because
// they are geometry, not color.
const SENSOR_R = 15
const ACTOR_SIDE = 26
const MIXER_R = 17 // half-diagonal of the diamond
const PLANNER_R = 17
const CORE_R = 24

export interface ShapeStyle {
  fill: string
  stroke: string
  strokeWidth: number
  opacity: number
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    // Flat-top hexagon: first vertex at -90° then every 60°.
    const a = (Math.PI / 180) * (60 * i - 90)
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`)
  }
  return pts.join(' ')
}

/**
 * Renders the category-appropriate SVG shape centered at (cx, cy), scaled by
 * `scale`. Shared between graph nodes and the legend glyphs so the two never
 * drift visually. Planner is outline-only (no fill) — a placeholder shape
 * since no Planner nodes exist yet.
 */
export function shapeElement(
  category: string,
  cx: number,
  cy: number,
  scale: number,
  style: ShapeStyle,
): ReactElement {
  const { fill, stroke, strokeWidth, opacity } = style
  switch (category) {
    case 'Actor': {
      const h = ACTOR_SIDE * scale
      return (
        <rect
          x={cx - h / 2}
          y={cy - h / 2}
          width={h}
          height={h}
          rx={3 * scale}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      )
    }
    case 'Mixer': {
      const r = MIXER_R * scale
      const pts = `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`
      return <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={strokeWidth} opacity={opacity} />
    }
    case 'Planner': {
      const r = PLANNER_R * scale
      return (
        <polygon
          points={hexPoints(cx, cy, r)}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      )
    }
    case 'Sensor':
    default: {
      return (
        <circle
          cx={cx}
          cy={cy}
          r={SENSOR_R * scale}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      )
    }
  }
}

export interface NodeSymbolProps {
  node: TopologyNode
  x: number
  y: number
  isCore: boolean
  labelX: number
  labelY: number
  labelAnchor: 'start' | 'middle' | 'end'
  isHovered: boolean
  /** True when some OTHER node is hovered — this one dims to focus the hover. */
  dimmed: boolean
  onHoverChange: (id: string | null) => void
}

export function NodeSymbol({
  node,
  x,
  y,
  isCore,
  labelX,
  labelY,
  labelAnchor,
  isHovered,
  dimmed,
  onHoverChange,
}: NodeSymbolProps): ReactElement {
  const cat = styleFor(node.category)
  // Core always renders at full opacity: its "stopped" status is a dispatch-
  // host artifact, not a real outage (see types.ts CORE_NODE_ID).
  const baseOpacity = isCore ? 1 : opacityFor(node.status)
  const opacity = isHovered ? 1 : dimmed ? baseOpacity * 0.4 : baseOpacity

  const surfaceCount = node.surfaces.length
  const title = `${node.id} · ${node.category} · ${surfaceCount} surface${surfaceCount === 1 ? '' : 's'} · ${node.status}`

  return (
    <g
      className={`mv-node${isHovered ? ' mv-node--hover' : ''}`}
      onMouseEnter={() => onHoverChange(node.id)}
      onMouseLeave={() => onHoverChange(null)}
      style={isHovered ? { filter: `drop-shadow(0 0 7px ${cat.fill})` } : undefined}
    >
      <title>{title}</title>
      {isCore ? (
        <>
          {/* Dispatch host: larger circle with a bright double outline so it
              never reads as just another Mixer circle. */}
          <circle cx={x} cy={y} r={CORE_R + 6} fill="none" stroke="#ffffff" strokeWidth={1.5} opacity={0.35} />
          <circle
            cx={x}
            cy={y}
            r={CORE_R}
            fill="var(--holo-panel)"
            stroke="var(--holo-accent)"
            strokeWidth={isHovered ? 3 : 2.5}
            opacity={1}
          />
        </>
      ) : (
        shapeElement(node.category, x, y, isHovered ? 1.18 : 1, {
          fill: node.category === 'Planner' ? 'none' : cat.fill,
          stroke: cat.stroke,
          strokeWidth: isHovered ? 2.5 : 1.5,
          opacity,
        })
      )}
      <text
        x={labelX}
        y={labelY}
        textAnchor={labelAnchor}
        dominantBaseline="middle"
        fontSize={14}
        fill={isCore ? 'var(--holo-accent)' : 'var(--holo-text)'}
        fontWeight={isHovered || isCore ? 600 : 400}
        opacity={dimmed && !isHovered ? 0.4 : 0.92}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {node.id}
      </text>
    </g>
  )
}
