import { memo, useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import { StickyNote, Link, Lightbulb, HelpCircle, Star } from 'lucide-react';
import type { GraphNode } from '../../types';
import { NODE_TYPES } from '../../constants';
import { useGraphStore } from '../../store/graphStore';
import { CIRCLE_RADIUS } from '../../utils/edgeUtils';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  StickyNote,
  Link,
  Lightbulb,
  HelpCircle,
  Star,
};

interface CustomNodeData extends GraphNode {
  selected?: boolean;
  isSearchMatch?: boolean;
  isEdgeSource?: boolean;  // Highlighted as source in edge creation mode
}

function CustomNodeComponent({ data: rawData, selected }: NodeProps) {
  const data = rawData as unknown as CustomNodeData;
  const [isHovered, setIsHovered] = useState(false);

  const categories = useGraphStore((s) => s.categories);

  const nodeTypeConfig = NODE_TYPES[data.type] || NODE_TYPES.note;
  const category = categories.find((c) => c.id === data.categoryId);
  const nodeColor = data.color || category?.color || nodeTypeConfig.color;
  const Icon = iconMap[nodeTypeConfig.icon] || StickyNote;

  // Preview: first ~40 chars of body
  const preview = data.body?.slice(0, 40).trim() + (data.body?.length > 40 ? '...' : '');

  // Full description for hover expansion
  const fullDescription = data.body?.slice(0, 200) + (data.body?.length > 200 ? '...' : '');

  const circleSize = CIRCLE_RADIUS * 2; // 40px

  return (
    <div
      className="relative flex items-start gap-3 group drag-handle cursor-grab active:cursor-grabbing"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Circle icon */}
      <div
        className={`
          flex-shrink-0 flex items-center justify-center rounded-full
          transition-all duration-200
          ${selected
            ? 'ring-2 ring-[var(--holo-accent)] ring-offset-2 ring-offset-[var(--holo-bg)]'
            : ''
          }
          ${data.isEdgeSource ? 'ring-2 ring-cyan-400 shadow-[0_0_20px_rgba(0,200,255,0.6)]' : ''}
          ${data.isSearchMatch ? 'ring-2 ring-yellow-400' : ''}
        `}
        style={{
          width: circleSize,
          height: circleSize,
          background: `linear-gradient(135deg, ${nodeColor}, ${nodeColor}cc)`,
          boxShadow: selected
            ? `0 0 20px ${nodeColor}60, 0 4px 12px rgba(0,0,0,0.4)`
            : `0 2px 8px rgba(0,0,0,0.3)`,
        }}
      >
        <Icon className="w-5 h-5 text-white/90" />
      </div>

      {/* Text content */}
      <div className="flex flex-col min-w-[140px] max-w-[200px] pt-0.5">
        {/* Title */}
        <span
          className={`
            text-sm font-semibold leading-tight transition-colors
            ${selected ? 'text-[var(--holo-accent)]' : 'text-[var(--holo-text)]'}
          `}
        >
          {data.title}
        </span>

        {/* Preview - always visible */}
        {preview && (
          <span className="text-xs text-[var(--holo-muted)] mt-0.5 leading-snug">
            {preview}
          </span>
        )}

        {/* Expanded description on hover */}
        <div
          className={`
            overflow-hidden transition-all duration-300 ease-out
            ${isHovered && fullDescription ? 'max-h-32 opacity-100 mt-2' : 'max-h-0 opacity-0'}
          `}
        >
          <div className="text-xs text-[var(--holo-text)]/80 leading-relaxed p-2 rounded-lg bg-[var(--holo-bg)]/80 border border-[var(--holo-border)]">
            {fullDescription}
          </div>
        </div>

        {/* Tags - show on hover */}
        {data.tags && data.tags.length > 0 && (
          <div
            className={`
              flex flex-wrap gap-1 overflow-hidden transition-all duration-300
              ${isHovered ? 'max-h-20 opacity-100 mt-1.5' : 'max-h-0 opacity-0'}
            `}
          >
            {data.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 text-[9px] rounded-full bg-[var(--holo-accent)]/10 text-[var(--holo-accent)] border border-[var(--holo-accent)]/20"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Edge source indicator pulse */}
      {data.isEdgeSource && (
        <div
          className="absolute rounded-full pointer-events-none animate-ping"
          style={{
            width: circleSize + 8,
            height: circleSize + 8,
            left: -4,
            top: -4,
            border: '2px solid rgba(0, 200, 255, 0.5)',
          }}
        />
      )}
    </div>
  );
}

export const CustomNode = memo(CustomNodeComponent);
