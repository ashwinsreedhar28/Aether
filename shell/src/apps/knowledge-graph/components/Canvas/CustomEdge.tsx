import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps
} from '@xyflow/react';
import type { GraphEdge } from '../../types';
import { EDGE_TYPES } from '../../constants';
import { useGraphStore } from '../../store/graphStore';

type CustomEdgeData = Omit<GraphEdge, 'source' | 'target'>;

function CustomEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data: rawData,
  selected,
}: EdgeProps) {
  const data = rawData as unknown as CustomEdgeData | undefined;
  const selectEdge = useGraphStore((s) => s.selectEdge);

  const edgeConfig = EDGE_TYPES[data?.type || 'relates'];
  const edgeColor = data?.color || edgeConfig.color;
  const edgeStyle = data?.style || edgeConfig.defaultStyle;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Generate stroke-dasharray based on style
  const strokeDasharray =
    edgeStyle === 'dashed' ? '8 4' :
    edgeStyle === 'dotted' ? '2 4' :
    undefined;

  return (
    <>
      {/* Invisible wider path for easier selection */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="cursor-pointer"
        onClick={() => selectEdge(id)}
      />

      {/* Visible edge */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: edgeColor,
          strokeWidth: selected ? 3 : 2,
          strokeDasharray,
          filter: selected ? `drop-shadow(0 0 6px ${edgeColor})` : undefined,
          transition: 'stroke-width 0.2s, filter 0.2s',
        }}
        className={data?.animated ? 'animated' : ''}
      />

      {/* Edge label */}
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className={`
              px-2 py-1 text-[10px] rounded-md
              bg-[var(--holo-bg)]/90 border border-[var(--holo-border)]
              text-[var(--holo-muted)] cursor-pointer
              hover:text-[var(--holo-text)] hover:border-[var(--holo-accent)]/50
              transition-colors
            `}
            onClick={() => selectEdge(id)}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}

      {/* Bidirectional indicator */}
      {data?.bidirectional && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${sourceX + 20}px, ${sourceY}px)`,
            }}
            className="text-[var(--holo-muted)] text-xs"
          >
            ↔
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const CustomEdge = memo(CustomEdgeComponent);
