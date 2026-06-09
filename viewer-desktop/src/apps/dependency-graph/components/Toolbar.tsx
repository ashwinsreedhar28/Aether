/**
 * Dependency Graph Toolbar
 */

import { RefreshCw, ZoomIn, ZoomOut, Maximize2, Filter, LayoutGrid } from 'lucide-react';
import type { LayoutDirection } from '../utils/layoutEngine';

interface ToolbarProps {
  onRefresh: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onToggleFilter: () => void;
  direction: LayoutDirection;
  onDirectionChange: (direction: LayoutDirection) => void;
  isLoading: boolean;
  stats: {
    totalFiles: number;
    totalEdges: number;
    entryPoints: number;
  } | null;
}

export function Toolbar({
  onRefresh,
  onZoomIn,
  onZoomOut,
  onFitView,
  onToggleFilter,
  direction,
  onDirectionChange,
  isLoading,
  stats,
}: ToolbarProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--holo-border)] bg-[var(--holo-bg)]">
      {/* Left: Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-1.5 rounded hover:bg-[var(--holo-border)]/50 text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors disabled:opacity-50"
          title="Refresh graph"
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>

        <div className="w-px h-5 bg-[var(--holo-border)]" />

        <button
          onClick={onZoomIn}
          className="p-1.5 rounded hover:bg-[var(--holo-border)]/50 text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
          title="Zoom in"
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={onZoomOut}
          className="p-1.5 rounded hover:bg-[var(--holo-border)]/50 text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
          title="Zoom out"
        >
          <ZoomOut size={16} />
        </button>
        <button
          onClick={onFitView}
          className="p-1.5 rounded hover:bg-[var(--holo-border)]/50 text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
          title="Fit view"
        >
          <Maximize2 size={16} />
        </button>

        <div className="w-px h-5 bg-[var(--holo-border)]" />

        {/* Layout direction */}
        <div className="flex items-center gap-1">
          <LayoutGrid size={14} className="text-[var(--holo-muted)]" />
          <select
            value={direction}
            onChange={(e) => onDirectionChange(e.target.value as LayoutDirection)}
            className="bg-transparent text-xs text-[var(--holo-text)] border border-[var(--holo-border)] rounded px-1.5 py-1 focus:outline-none focus:border-[var(--holo-accent)]"
          >
            <option value="LR">Left → Right</option>
            <option value="RL">Right → Left</option>
            <option value="TB">Top → Bottom</option>
            <option value="BT">Bottom → Top</option>
          </select>
        </div>

        <div className="w-px h-5 bg-[var(--holo-border)]" />

        <button
          onClick={onToggleFilter}
          className="p-1.5 rounded hover:bg-[var(--holo-border)]/50 text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
          title="Filter options"
        >
          <Filter size={16} />
        </button>
      </div>

      {/* Right: Stats */}
      <div className="flex items-center gap-4 text-xs text-[var(--holo-muted)]">
        {isLoading ? (
          <span>Scanning...</span>
        ) : stats ? (
          <>
            <span>
              <span className="text-[var(--holo-text)]">{stats.totalFiles}</span> files
            </span>
            <span>
              <span className="text-[var(--holo-text)]">{stats.totalEdges}</span> imports
            </span>
            <span>
              <span className="text-green-400">{stats.entryPoints}</span> entry points
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
