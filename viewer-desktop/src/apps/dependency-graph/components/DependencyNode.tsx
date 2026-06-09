/**
 * Custom React Flow node for dependency visualization
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { DependencyNodeData } from '../types';

const EXTENSION_COLORS: Record<string, string> = {
  tsx: 'border-cyan-500 bg-cyan-500/10',
  ts: 'border-blue-500 bg-blue-500/10',
  jsx: 'border-orange-500 bg-orange-500/10',
  js: 'border-yellow-500 bg-yellow-500/10',
  mjs: 'border-yellow-400 bg-yellow-400/10',
  cjs: 'border-yellow-600 bg-yellow-600/10',
};

const EXTENSION_BADGES: Record<string, string> = {
  tsx: 'bg-cyan-500/30 text-cyan-300',
  ts: 'bg-blue-500/30 text-blue-300',
  jsx: 'bg-orange-500/30 text-orange-300',
  js: 'bg-yellow-500/30 text-yellow-300',
  mjs: 'bg-yellow-400/30 text-yellow-200',
  cjs: 'bg-yellow-600/30 text-yellow-200',
};

function DependencyNodeComponent({ data, selected }: NodeProps<Node<DependencyNodeData>>) {
  const colorClass = data.isExternal
    ? 'border-gray-500 bg-gray-500/10'
    : data.isEntryPoint
      ? 'border-green-500 bg-green-500/10'
      : EXTENSION_COLORS[data.extension] || 'border-purple-500 bg-purple-500/10';

  const badgeClass = data.isExternal
    ? 'bg-gray-500/30 text-gray-300'
    : EXTENSION_BADGES[data.extension] || 'bg-purple-500/30 text-purple-300';

  return (
    <>
      {/* Input handle (files importing this) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[var(--holo-border)] !border-[var(--holo-accent)] !w-2 !h-2"
      />

      <div
        className={`
          px-3 py-2 rounded-lg border-2 min-w-[140px] max-w-[200px]
          ${colorClass}
          ${selected ? 'ring-2 ring-[var(--holo-accent)] ring-offset-2 ring-offset-[var(--holo-bg)]' : ''}
          hover:brightness-110 transition-all duration-150
          cursor-pointer
        `}
      >
        {/* Header with badge */}
        <div className="flex items-center gap-2">
          {/* Extension badge */}
          {!data.isExternal && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono uppercase ${badgeClass}`}>
              {data.extension}
            </span>
          )}

          {/* Entry point indicator */}
          {data.isEntryPoint && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/30 text-green-300">
              entry
            </span>
          )}

          {/* External indicator */}
          {data.isExternal && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/30 text-gray-400">
              npm
            </span>
          )}
        </div>

        {/* File name */}
        <div
          className="text-sm font-medium text-[var(--holo-text)] truncate mt-1"
          title={data.label}
        >
          {data.label}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-[var(--holo-muted)]">
          {data.importCount > 0 && (
            <span title={`Imports ${data.importCount} files`}>
              ↓ {data.importCount}
            </span>
          )}
          {data.importedByCount > 0 && (
            <span title={`Imported by ${data.importedByCount} files`}>
              ↑ {data.importedByCount}
            </span>
          )}
        </div>
      </div>

      {/* Output handle (files this imports) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[var(--holo-border)] !border-[var(--holo-accent)] !w-2 !h-2"
      />
    </>
  );
}

export const DependencyNode = memo(DependencyNodeComponent);
