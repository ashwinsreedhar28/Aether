/**
 * Filter panel for dependency graph
 */

import { X, FileCode, Box, Trash2 } from 'lucide-react';

interface FilterPanelProps {
  onClose: () => void;
  showExternal: boolean;
  onToggleExternal: (show: boolean) => void;
  maxDepth: number;
  onMaxDepthChange: (depth: number) => void;
  excludePatterns: string[];
  onExcludePatternsChange: (patterns: string[]) => void;
}

export function FilterPanel({
  onClose,
  showExternal,
  onToggleExternal,
  maxDepth,
  onMaxDepthChange,
  excludePatterns,
  onExcludePatternsChange,
}: FilterPanelProps) {
  const handleAddPattern = () => {
    const pattern = prompt('Enter pattern to exclude (e.g., __tests__, .spec.)');
    if (pattern && !excludePatterns.includes(pattern)) {
      onExcludePatternsChange([...excludePatterns, pattern]);
    }
  };

  const handleRemovePattern = (pattern: string) => {
    onExcludePatternsChange(excludePatterns.filter((p) => p !== pattern));
  };

  return (
    <div className="absolute top-12 left-3 z-50 w-72 bg-[var(--holo-bg)] border border-[var(--holo-border)] rounded-lg shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--holo-border)]">
        <span className="text-sm font-medium text-[var(--holo-text)]">Filter Options</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--holo-border)]/50 text-[var(--holo-muted)]"
        >
          <X size={14} />
        </button>
      </div>

      <div className="p-3 space-y-4">
        {/* External dependencies toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Box size={14} className="text-[var(--holo-muted)]" />
            <span className="text-sm text-[var(--holo-text)]">Show npm packages</span>
          </div>
          <button
            onClick={() => onToggleExternal(!showExternal)}
            className={`
              w-10 h-5 rounded-full transition-colors relative
              ${showExternal ? 'bg-[var(--holo-accent)]' : 'bg-[var(--holo-border)]'}
            `}
          >
            <div
              className={`
                absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform
                ${showExternal ? 'left-5' : 'left-0.5'}
              `}
            />
          </button>
        </div>

        {/* Max depth slider */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm text-[var(--holo-text)]">Max depth</span>
            <span className="text-xs text-[var(--holo-muted)]">{maxDepth === 20 ? '∞' : maxDepth}</span>
          </div>
          <input
            type="range"
            min={1}
            max={20}
            value={maxDepth}
            onChange={(e) => onMaxDepthChange(parseInt(e.target.value))}
            className="w-full h-1.5 bg-[var(--holo-border)] rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-[var(--holo-accent)]
              [&::-webkit-slider-thumb]:cursor-pointer
            "
          />
        </div>

        {/* Exclude patterns */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FileCode size={14} className="text-[var(--holo-muted)]" />
              <span className="text-sm text-[var(--holo-text)]">Exclude patterns</span>
            </div>
            <button
              onClick={handleAddPattern}
              className="text-xs px-2 py-0.5 rounded bg-[var(--holo-border)]/50 hover:bg-[var(--holo-border)] text-[var(--holo-muted)] hover:text-[var(--holo-text)]"
            >
              + Add
            </button>
          </div>

          <div className="space-y-1 max-h-32 overflow-y-auto">
            {excludePatterns.length === 0 ? (
              <span className="text-xs text-[var(--holo-muted)]">No exclude patterns</span>
            ) : (
              excludePatterns.map((pattern) => (
                <div
                  key={pattern}
                  className="flex items-center justify-between px-2 py-1 rounded bg-[var(--holo-border)]/30 group"
                >
                  <span className="text-xs text-[var(--holo-text)] font-mono">{pattern}</span>
                  <button
                    onClick={() => handleRemovePattern(pattern)}
                    className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-red-400"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
