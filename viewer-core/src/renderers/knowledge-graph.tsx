/**
 * Knowledge-graph renderer — a read-only view of a mindmap document.
 *
 * Pure: parses `data.content` (the .mindmap file format) and draws nodes at
 * their stored positions with edges between them as an SVG overlay. The desktop
 * shell layers interactive editing (drag, edge creation, stores) on top via
 * @xyflow/react — that interactivity is a shell concern and is intentionally NOT
 * part of the shared renderer. This gives the spatial shell a faithful static
 * graph without pulling in the heavy editing stack.
 */
import { useMemo } from 'react';
import type { ViewRendererProps } from './registry';

interface GraphNode {
  id: string;
  title: string;
  position: { x: number; y: number };
  color?: string;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

interface MindmapFile {
  name?: string;
  nodes?: GraphNode[];
  edges?: GraphEdge[];
}

const NODE_W = 160;
const NODE_H = 56;
const PAD = 80;

export function KnowledgeGraphRenderer({ data }: ViewRendererProps) {
  const graph = useMemo<MindmapFile | null>(() => {
    try {
      return JSON.parse(data.content) as MindmapFile;
    } catch {
      return null;
    }
  }, [data.content]);

  const layout = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    if (nodes.length === 0) return null;
    const minX = Math.min(...nodes.map((n) => n.position.x));
    const minY = Math.min(...nodes.map((n) => n.position.y));
    const maxX = Math.max(...nodes.map((n) => n.position.x + NODE_W));
    const maxY = Math.max(...nodes.map((n) => n.position.y + NODE_H));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return {
      nodes,
      byId,
      offsetX: minX - PAD,
      offsetY: minY - PAD,
      width: maxX - minX + PAD * 2,
      height: maxY - minY + PAD * 2,
    };
  }, [graph]);

  if (!graph || !layout) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">
        {graph ? 'Empty graph' : 'Invalid graph'}
      </div>
    );
  }

  const edges = graph.edges ?? [];

  return (
    <div className="h-full overflow-auto bg-[rgba(0,0,0,0.3)]">
      <div
        className="relative"
        style={{ width: layout.width, height: layout.height, minWidth: '100%', minHeight: '100%' }}
      >
        <svg
          className="absolute inset-0 pointer-events-none"
          width={layout.width}
          height={layout.height}
        >
          {edges.map((edge) => {
            const a = layout.byId.get(edge.source);
            const b = layout.byId.get(edge.target);
            if (!a || !b) return null;
            const x1 = a.position.x - layout.offsetX + NODE_W / 2;
            const y1 = a.position.y - layout.offsetY + NODE_H / 2;
            const x2 = b.position.x - layout.offsetX + NODE_W / 2;
            const y2 = b.position.y - layout.offsetY + NODE_H / 2;
            return (
              <g key={edge.id}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="var(--holo-accent, #4a9eff)"
                  strokeWidth={1.5}
                  strokeOpacity={0.6}
                />
                {edge.label && (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2}
                    fill="var(--holo-muted, #9aa0b5)"
                    fontSize={10}
                    textAnchor="middle"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {layout.nodes.map((node) => (
          <div
            key={node.id}
            className="absolute rounded-lg border border-[var(--holo-border)] bg-[rgba(15,15,25,0.85)] px-3 py-2 text-xs text-[var(--holo-text)] flex items-center justify-center text-center"
            style={{
              left: node.position.x - layout.offsetX,
              top: node.position.y - layout.offsetY,
              width: NODE_W,
              minHeight: NODE_H,
              borderColor: node.color ?? undefined,
            }}
          >
            {node.title}
          </div>
        ))}
      </div>
    </div>
  );
}
