import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import { useGraphStore, selectSearchResults } from '../../store/graphStore';
import { NODE_TYPES } from '../../constants';

interface SearchPanelProps {
  onClose: () => void;
}

export function SearchPanel({ onClose }: SearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const searchQuery = useGraphStore((s) => s.searchQuery);
  const setSearchQuery = useGraphStore((s) => s.setSearchQuery);
  // Use useShallow to prevent infinite re-renders from array reference changes
  const results = useGraphStore(useShallow(selectSearchResults));
  const setSelectedNodes = useGraphStore((s) => s.setSelectedNodes);
  const setEditingNode = useGraphStore((s) => s.setEditingNode);
  const setViewport = useGraphStore((s) => s.setViewport);
  const viewport = useGraphStore((s) => s.viewport);
  const nodes = useGraphStore((s) => s.nodes);

  // Filter to only matched nodes when there's a query
  const matchedNodes = useMemo(
    () =>
      searchQuery.trim()
        ? results.filter((n) => {
            const query = searchQuery.toLowerCase();
            return (
              n.title.toLowerCase().includes(query) ||
              n.body.toLowerCase().includes(query) ||
              n.tags?.some((t) => t.toLowerCase().includes(query))
            );
          })
        : [],
    [searchQuery, results]
  );

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset index when the query changes (render-phase state adjustment)
  const [prevSearchQuery, setPrevSearchQuery] = useState(searchQuery);
  if (searchQuery !== prevSearchQuery) {
    setPrevSearchQuery(searchQuery);
    setCurrentIndex(0);
  }

  const navigateToNode = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // Center viewport on node
    setViewport({
      x: -node.position.x + 400,
      y: -node.position.y + 300,
      zoom: viewport.zoom,
    });

    setSelectedNodes([nodeId]);
    setEditingNode(nodeId);
  }, [nodes, viewport.zoom, setViewport, setSelectedNodes, setEditingNode]);

  const handleNext = useCallback(() => {
    if (matchedNodes.length === 0) return;
    const nextIndex = (currentIndex + 1) % matchedNodes.length;
    setCurrentIndex(nextIndex);
    navigateToNode(matchedNodes[nextIndex].id);
  }, [currentIndex, matchedNodes, navigateToNode]);

  const handlePrev = useCallback(() => {
    if (matchedNodes.length === 0) return;
    const prevIndex = (currentIndex - 1 + matchedNodes.length) % matchedNodes.length;
    setCurrentIndex(prevIndex);
    navigateToNode(matchedNodes[prevIndex].id);
  }, [currentIndex, matchedNodes, navigateToNode]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        handlePrev();
      } else {
        handleNext();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      handleNext();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      handlePrev();
    }
  }, [onClose, handleNext, handlePrev]);

  const handleClose = useCallback(() => {
    setSearchQuery('');
    onClose();
  }, [setSearchQuery, onClose]);

  return (
    <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 w-[400px]">
      <div className="bg-[var(--holo-bg)]/95 border border-[var(--holo-border)] rounded-xl shadow-2xl backdrop-blur-sm overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--holo-border)]">
          <Search className="w-4 h-4 text-[var(--holo-muted)]" />
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search nodes..."
            className="flex-1 bg-transparent text-sm text-[var(--holo-text)] outline-none placeholder:text-[var(--holo-muted)]"
          />
          {searchQuery && (
            <span className="text-xs text-[var(--holo-muted)]">
              {matchedNodes.length > 0 ? `${currentIndex + 1}/${matchedNodes.length}` : '0 results'}
            </span>
          )}
          <button
            onClick={handlePrev}
            disabled={matchedNodes.length === 0}
            className="p-1 rounded hover:bg-[var(--holo-accent)]/10 text-[var(--holo-muted)] disabled:opacity-40"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={handleNext}
            disabled={matchedNodes.length === 0}
            className="p-1 rounded hover:bg-[var(--holo-accent)]/10 text-[var(--holo-muted)] disabled:opacity-40"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-[var(--holo-accent)]/10 text-[var(--holo-muted)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results list */}
        {searchQuery && matchedNodes.length > 0 && (
          <div className="max-h-[300px] overflow-y-auto">
            {matchedNodes.map((node, index) => {
              const nodeType = NODE_TYPES[node.type];
              return (
                <button
                  key={node.id}
                  onClick={() => {
                    setCurrentIndex(index);
                    navigateToNode(node.id);
                  }}
                  className={`
                    w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                    ${index === currentIndex
                      ? 'bg-[var(--holo-accent)]/20'
                      : 'hover:bg-[var(--holo-border)]/30'
                    }
                  `}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: node.color || nodeType.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--holo-text)] truncate">
                      {highlightMatch(node.title, searchQuery)}
                    </p>
                    {node.body && (
                      <p className="text-xs text-[var(--holo-muted)] truncate">
                        {highlightMatch(node.body.slice(0, 60), searchQuery)}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-[var(--holo-muted)]">
                    {nodeType.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {searchQuery && matchedNodes.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-[var(--holo-muted)]">
            No nodes found matching "{searchQuery}"
          </div>
        )}

        {/* Keyboard hints */}
        <div className="px-4 py-2 border-t border-[var(--holo-border)] flex items-center gap-4 text-xs text-[var(--holo-muted)]">
          <span><kbd className="px-1.5 py-0.5 rounded bg-[var(--holo-border)]/50">↑↓</kbd> navigate</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-[var(--holo-border)]/50">Enter</kbd> select</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-[var(--holo-border)]/50">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) return text;

  return (
    <>
      {text.slice(0, index)}
      <span className="bg-yellow-400/30 text-yellow-200">
        {text.slice(index, index + query.length)}
      </span>
      {text.slice(index + query.length)}
    </>
  );
}
