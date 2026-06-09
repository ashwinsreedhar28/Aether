import { memo } from 'react';
import { useInternalNode, type EdgeProps } from '@xyflow/react';
import { getEdgeParams, getBezierControlPoints } from '../../utils/edgeUtils';
import type { GraphEdge } from '../../types';
import { EDGE_TYPES } from '../../constants';
import { useGraphStore } from '../../store/graphStore';

type FloatingEdgeData = Omit<GraphEdge, 'source' | 'target'>;

function FloatingEdgeComponent({
  id,
  source,
  target,
  data: rawData,
  selected,
}: EdgeProps) {
  const data = rawData as unknown as FloatingEdgeData | undefined;
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const selectEdge = useGraphStore((s) => s.selectEdge);

  if (!sourceNode || !targetNode) {
    return null;
  }

  const edgeConfig = EDGE_TYPES[data?.type || 'relates'];
  const edgeColor = data?.color || edgeConfig.color;
  const edgeStyle = data?.style || edgeConfig.defaultStyle;

  // Get intersection points on circle boundaries
  const { sx, sy, tx, ty } = getEdgeParams(sourceNode, targetNode);

  // Calculate bezier control points for smooth curve
  const { c1, c2 } = getBezierControlPoints({ x: sx, y: sy }, { x: tx, y: ty });

  // Build path
  const path = `M ${sx} ${sy} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${tx} ${ty}`;

  // Generate stroke-dasharray based on style
  const strokeDasharray =
    edgeStyle === 'dashed' ? '8 4' :
    edgeStyle === 'dotted' ? '2 4' :
    undefined;

  // Calculate label position (midpoint of the curve)
  const labelX = (sx + tx) / 2;
  const labelY = (sy + ty) / 2;

  return (
    <g>
      {/* Invisible wider path for easier selection */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="cursor-pointer"
        onClick={() => selectEdge(id)}
      />

      {/* Visible edge */}
      <path
        id={id}
        d={path}
        fill="none"
        stroke={edgeColor}
        strokeWidth={selected ? 3 : 2}
        strokeDasharray={strokeDasharray}
        className={`transition-all duration-200 ${data?.animated ? 'animate-dash' : ''}`}
        style={{
          filter: selected ? `drop-shadow(0 0 6px ${edgeColor})` : undefined,
        }}
      />

      {/* Arrow marker at target */}
      <polygon
        points={getArrowPoints(tx, ty, c2.x, c2.y)}
        fill={edgeColor}
        className="transition-all duration-200"
        style={{
          filter: selected ? `drop-shadow(0 0 4px ${edgeColor})` : undefined,
        }}
      />

      {/* Edge label */}
      {data?.label && (
        <g transform={`translate(${labelX}, ${labelY})`}>
          <rect
            x={-30}
            y={-10}
            width={60}
            height={20}
            rx={4}
            fill="rgba(10, 10, 15, 0.9)"
            stroke="rgba(100, 150, 255, 0.2)"
            className="cursor-pointer"
            onClick={() => selectEdge(id)}
          />
          <text
            textAnchor="middle"
            dominantBaseline="middle"
            fill="rgba(255, 255, 255, 0.7)"
            fontSize={10}
            className="pointer-events-none select-none"
          >
            {data.label}
          </text>
        </g>
      )}
    </g>
  );
}

/**
 * Calculate arrow points for the edge marker
 */
function getArrowPoints(
  tx: number,
  ty: number,
  cx: number,
  cy: number
): string {
  const angle = Math.atan2(ty - cy, tx - cx);
  const arrowLength = 10;

  // Arrow tip is at (tx, ty)
  const tipX = tx;
  const tipY = ty;

  // Arrow base points
  const baseAngle1 = angle + Math.PI - 0.4;
  const baseAngle2 = angle + Math.PI + 0.4;

  const base1X = tipX + arrowLength * Math.cos(baseAngle1);
  const base1Y = tipY + arrowLength * Math.sin(baseAngle1);
  const base2X = tipX + arrowLength * Math.cos(baseAngle2);
  const base2Y = tipY + arrowLength * Math.sin(baseAngle2);

  return `${tipX},${tipY} ${base1X},${base1Y} ${base2X},${base2Y}`;
}

export const FloatingEdge = memo(FloatingEdgeComponent);
