import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, X, File, Folder, AppWindow } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useFileSystemStore } from '../../stores/fileSystemStore';
import { getApps } from '../../apps';
import { soundEngine } from '../../audio';
import type { FileNode } from '../../types';
import type { AppDefinition } from '../../apps/types';

interface SearchModalProps {
  tree: FileNode | null;
  onClose: () => void;
  onSelectFile: (path: string) => void;
}

interface FileResult {
  type: 'file' | 'directory';
  path: string;
  name: string;
  extension?: string;
}

interface AppResult {
  type: 'app';
  app: AppDefinition;
}

type SearchResult = FileResult | AppResult;

// Flatten tree into searchable list
function flattenTree(node: FileNode | null, list: FileResult[] = []): FileResult[] {
  if (!node) return list;

  if (node.type === 'file') {
    list.push({
      type: 'file',
      path: node.path,
      name: node.name,
      extension: node.extension,
    });
  } else if (node.type === 'directory') {
    list.push({
      type: 'directory',
      path: node.path,
      name: node.name,
    });
    // Recursively process children
    if (node.children) {
      node.children.forEach(child => flattenTree(child, list));
    }
  }

  return list;
}

export function SearchModal({ tree, onClose, onSelectFile }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { openWindow } = useWorkspaceStore();

  // Get app icon component
  const getAppIcon = (iconName: string) => {
    const Icon = (LucideIcons as unknown as Record<string, React.ComponentType<{ size?: number; className?: string }>>)[iconName];
    return Icon || AppWindow;
  };

  // Derive search results from the query + tree (pure — no effect needed)
  const results = useMemo<SearchResult[]>(() => {
    const queryLower = query.toLowerCase().trim();

    // Get all apps
    const apps = getApps();
    const appResults: AppResult[] = apps
      .filter(app =>
        !queryLower || app.name.toLowerCase().includes(queryLower)
      )
      .map(app => ({ type: 'app' as const, app }));

    // If no query, show just apps
    if (!queryLower) {
      return appResults;
    }

    // Get all files
    const allFiles = flattenTree(tree);

    // Filter files
    const fileResults: FileResult[] = allFiles
      .filter(item => {
        const nameLower = item.name.toLowerCase();
        const pathLower = item.path.toLowerCase();
        return nameLower.includes(queryLower) || pathLower.includes(queryLower);
      })
      .sort((a, b) => {
        // Exact match first
        const aNameMatch = a.name.toLowerCase() === queryLower;
        const bNameMatch = b.name.toLowerCase() === queryLower;
        if (aNameMatch && !bNameMatch) return -1;
        if (!aNameMatch && bNameMatch) return 1;

        // Then starts with
        const aStarts = a.name.toLowerCase().startsWith(queryLower);
        const bStarts = b.name.toLowerCase().startsWith(queryLower);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        // Then files before directories
        if (a.type === 'file' && b.type === 'directory') return -1;
        if (a.type === 'directory' && b.type === 'file') return 1;

        // Finally alphabetical
        return a.name.localeCompare(b.name);
      })
      .slice(0, 50); // Limit to 50 results

    // Combine: apps first, then files
    return [...appResults, ...fileResults];
  }, [query, tree]);

  // Reset the highlighted row when the query changes (render-phase adjustment)
  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setSelectedIndex(0);
  }

  // Handle selection
  const handleSelect = useCallback((result: SearchResult) => {
    if (result.type === 'app') {
      const tabId = `tab-${Date.now()}`;
      openWindow({
        title: result.app.name,
        tabs: [{
          id: tabId,
          title: result.app.name,
          filePath: result.app.id, // Use appId as filePath for standalone apps
          appId: result.app.id,
          isDirty: false,
          isActive: true,
        }],
        activeTabId: tabId,
        position: { x: 200 + Math.random() * 100, y: 100 + Math.random() * 100 },
        size: result.app.defaultSize || { width: 600, height: 500 },
        isMinimized: false,
        isMaximized: false,
      });
      onClose();
    } else if (result.type === 'file') {
      onSelectFile(result.path);
      onClose();
    }
  }, [openWindow, onClose, onSelectFile]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (selectedIndex < results.length - 1) {
          soundEngine.playEvent('search:navigate');
        }
        setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (selectedIndex > 0) {
          soundEngine.playEvent('search:navigate');
        }
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        e.preventDefault();
        handleSelect(results[selectedIndex]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [results, selectedIndex, onClose, handleSelect]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    const selected = document.querySelector('.search-result-selected');
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const shortenPath = (path: string) => {
    const rootDir = useFileSystemStore.getState().rootDir;
    return path.replace(rootDir, '~');
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl mx-4 bg-[var(--holo-panel)] border border-[var(--holo-border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--holo-border)]">
          <Search size={20} className="text-[var(--holo-muted)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files and apps..."
            className="flex-1 bg-transparent text-[var(--holo-text)] placeholder-[var(--holo-muted)] focus:outline-none"
          />
          <button
            onClick={onClose}
            className="text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto">
          {query && results.length === 0 && (
            <div className="px-4 py-8 text-center text-[var(--holo-muted)]">
              No results found for "{query}"
            </div>
          )}
          {!query && results.length > 0 && (
            <div className="px-4 py-2 text-xs text-[var(--holo-muted)] border-b border-[var(--holo-border)]">
              Apps
            </div>
          )}
          {results.map((result, index) => {
            if (result.type === 'app') {
              const AppIcon = getAppIcon(result.app.icon);
              return (
                <div
                  key={`app-${result.app.id}`}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                    index === selectedIndex
                      ? 'bg-[var(--holo-accent)]/20 search-result-selected'
                      : 'hover:bg-[var(--holo-accent)]/10'
                  }`}
                  onClick={() => handleSelect(result)}
                >
                  <div className="w-8 h-8 rounded-lg bg-[var(--holo-accent)]/20 flex items-center justify-center flex-shrink-0">
                    <AppIcon size={18} className="text-[var(--holo-accent)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[var(--holo-text)]">{result.app.name}</div>
                    <div className="text-xs text-[var(--holo-muted)]">
                      {result.app.fileTypes?.length
                        ? `Opens .${result.app.fileTypes.join(', .')} files`
                        : 'Application'}
                    </div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded bg-[var(--holo-accent)]/10 text-[var(--holo-accent)] flex-shrink-0">
                    App
                  </span>
                </div>
              );
            }

            // File or directory result
            return (
              <div
                key={result.path}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                  index === selectedIndex
                    ? 'bg-[var(--holo-accent)]/20 search-result-selected'
                    : 'hover:bg-[var(--holo-accent)]/10'
                }`}
                onClick={() => handleSelect(result)}
              >
                {result.type === 'file' ? (
                  <File size={16} className="text-[var(--holo-accent)] flex-shrink-0" />
                ) : (
                  <Folder size={16} className="text-[var(--holo-accent)] flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--holo-text)] truncate">{result.name}</div>
                  <div className="text-xs text-[var(--holo-muted)] truncate">
                    {shortenPath(result.path)}
                  </div>
                </div>
                {result.extension && (
                  <span className="text-xs text-[var(--holo-muted)] flex-shrink-0">
                    .{result.extension}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-[var(--holo-border)] text-xs text-[var(--holo-muted)] flex items-center justify-between">
            <span>
              <kbd className="px-1.5 py-0.5 bg-[var(--holo-bg)] rounded border border-[var(--holo-border)]">↑↓</kbd>
              {' '}Navigate
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-[var(--holo-bg)] rounded border border-[var(--holo-border)]">Enter</kbd>
              {' '}Open
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-[var(--holo-bg)] rounded border border-[var(--holo-border)]">Esc</kbd>
              {' '}Close
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
