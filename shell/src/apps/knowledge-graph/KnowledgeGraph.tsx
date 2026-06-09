import { useEffect, useState, useCallback, useRef } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import type { AppProps } from '../types';
import { useAppContext } from '../AppContext';
import { useFileWatcher } from '../../hooks/useFileWatcher';
import { useGraphStore } from './store/graphStore';
import { useKnowledgeGraphKeyboard } from './hooks/useKnowledgeGraphKeyboard';
import { createEmptyMindmap } from './constants';
import type { MindmapFile } from './types';

import { GraphCanvas } from './components/Canvas/GraphCanvas';
import { MainToolbar } from './components/Toolbar/MainToolbar';
import { DetailsSidebar } from './components/Sidebar/DetailsSidebar';
import { SearchPanel } from './components/Search/SearchPanel';

export function KnowledgeGraph({ windowId, filePath, isActive }: AppProps) {
  const { fileApi, setDirty, updateTab } = useAppContext();
  const { subscribeToFile } = useFileWatcher();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [hasExternalChange, setHasExternalChange] = useState(false);

  const initialLoadDone = useRef(false);
  const lastSavedContent = useRef<string>('');
  const ignoreNextFileChange = useRef(false);

  // Store state
  const sidebarOpen = useGraphStore((s) => s.sidebarOpen);
  const setSidebarOpen = useGraphStore((s) => s.setSidebarOpen);
  const importData = useGraphStore((s) => s.importData);
  const exportData = useGraphStore((s) => s.exportData);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  // Use useShallow to get stable array reference for selectedNodeIds
  const selectedNodeIdsArray = useGraphStore(
    useShallow((s) => Array.from(s.selectedNodeIds))
  );
  const edgeCreationMode = useGraphStore((s) => s.edgeCreationMode);
  const setSelectedNodes = useGraphStore((s) => s.setSelectedNodes);
  const clearSelection = useGraphStore((s) => s.clearSelection);
  const setEdgeCreationMode = useGraphStore((s) => s.setEdgeCreationMode);
  const setEdgeCreationSource = useGraphStore((s) => s.setEdgeCreationSource);

  // Load file on mount
  useEffect(() => {
    if (!filePath || initialLoadDone.current) return;

    const loadFile = async () => {
      try {
        setLoading(true);
        const { content } = await fileApi.readFile(filePath);
        const data: MindmapFile = JSON.parse(content);
        importData(data);
        lastSavedContent.current = content;

        // Update tab title
        updateTab({ title: data.name || 'Knowledge Graph' });
      } catch (err) {
        // If file doesn't exist or is empty, create new
        if (err instanceof Error && err.message.includes('ENOENT')) {
          const newData = createEmptyMindmap('New Knowledge Graph');
          importData(newData);
          // Save the new file
          const content = JSON.stringify(newData, null, 2);
          ignoreNextFileChange.current = true;
          await fileApi.writeFile(filePath, content);
          lastSavedContent.current = content;
        } else {
          console.error('Failed to load mindmap:', err);
          setError(err instanceof Error ? err.message : 'Failed to load file');
        }
      } finally {
        setLoading(false);
        initialLoadDone.current = true;
      }
    };

    loadFile();
  }, [filePath, fileApi, importData, updateTab]);

  // Auto-save on changes
  useEffect(() => {
    if (!filePath || !initialLoadDone.current || loading) return;

    const data = exportData();
    const content = JSON.stringify(data, null, 2);

    // Check if content actually changed
    if (content === lastSavedContent.current) {
      setDirty(false);
      return;
    }

    setDirty(true);

    const saveTimer = setTimeout(async () => {
      try {
        ignoreNextFileChange.current = true;
        await fileApi.writeFile(filePath, content);
        lastSavedContent.current = content;
        setDirty(false);
      } catch (err) {
        console.error('Failed to save mindmap:', err);
        ignoreNextFileChange.current = false;
      }
    }, 500);

    return () => clearTimeout(saveTimer);
  }, [filePath, nodes, edges, exportData, fileApi, setDirty, loading]);

  // Watch for external file changes
  useEffect(() => {
    if (!filePath) return;

    const unsubscribe = subscribeToFile(filePath, () => {
      // Ignore file changes caused by our own autosave
      if (ignoreNextFileChange.current) {
        ignoreNextFileChange.current = false;
        return;
      }
      setHasExternalChange(true);
    });

    return unsubscribe;
  }, [filePath, subscribeToFile]);

  // Reload from external change
  const handleReload = useCallback(async () => {
    if (!filePath) return;

    try {
      const { content } = await fileApi.readFile(filePath);
      const data: MindmapFile = JSON.parse(content);
      importData(data);
      lastSavedContent.current = content;
      setHasExternalChange(false);
    } catch (err) {
      console.error('Failed to reload:', err);
    }
  }, [filePath, fileApi, importData]);

  // Use keyboard hook for arrow navigation and edge creation
  useKnowledgeGraphKeyboard({
    isActive,
    nodes,
    selectedNodeIds: selectedNodeIdsArray,
    edgeCreationMode,
    sidebarOpen,
    onSelectNode: useCallback((nodeId: string) => {
      setSelectedNodes([nodeId]);
    }, [setSelectedNodes]),
    onClearSelection: clearSelection,
    onEnterEdgeMode: useCallback(() => {
      setEdgeCreationMode(true);
    }, [setEdgeCreationMode]),
    onExitEdgeMode: useCallback(() => {
      setEdgeCreationMode(false);
      setEdgeCreationSource(null);
    }, [setEdgeCreationMode, setEdgeCreationSource]),
    onCloseSidebar: useCallback(() => {
      setSidebarOpen(false);
    }, [setSidebarOpen]),
  });

  // Additional keyboard shortcuts (Cmd+F for search)
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+F or Ctrl+F for search
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
      }

      // Escape to close search panel
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, showSearch]);

  // Placeholder handlers
  const handleExport = useCallback(() => {
    const data = exportData();
    const content = JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.name || 'knowledge-graph'}.mindmap`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportData]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mindmap,.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const content = await file.text();
        const data: MindmapFile = JSON.parse(content);
        importData(data);
        setDirty(true);
      } catch (err) {
        console.error('Failed to import:', err);
        alert('Failed to import file. Make sure it\'s a valid .mindmap file.');
      }
    };
    input.click();
  }, [importData, setDirty]);

  const handleAutoLayout = useCallback(() => {
    // TODO: Implement force-directed layout
    alert('Auto-layout coming soon!');
  }, []);

  const handleSettings = useCallback(() => {
    // TODO: Implement settings panel
    alert('Settings coming soon!');
  }, []);

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[var(--holo-bg)]">
        <div className="text-[var(--holo-muted)]">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[var(--holo-bg)]">
        <div className="text-center">
          <p className="text-red-400 mb-2">Failed to load</p>
          <p className="text-[var(--holo-muted)] text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="h-full w-full flex flex-col bg-[var(--holo-bg)] overflow-hidden">
        {/* Toolbar */}
        <MainToolbar
          onSearch={() => setShowSearch(true)}
          onFilter={() => setShowFilter(!showFilter)}
          onExport={handleExport}
          onImport={handleImport}
          onAutoLayout={handleAutoLayout}
          onSettings={handleSettings}
        />

        {/* Main content */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Canvas */}
          <div className="flex-1 relative">
            <GraphCanvas windowId={windowId} />

            {/* Search panel */}
            {showSearch && (
              <SearchPanel onClose={() => setShowSearch(false)} />
            )}

            {/* External change notification */}
            {hasExternalChange && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50">
                <div className="bg-yellow-500/20 border border-yellow-500/40 rounded-lg px-4 py-2 flex items-center gap-3">
                  <span className="text-sm text-yellow-200">
                    File changed externally
                  </span>
                  <button
                    onClick={handleReload}
                    className="px-3 py-1 text-xs bg-yellow-500/30 hover:bg-yellow-500/40 rounded-md text-yellow-100"
                  >
                    Reload
                  </button>
                  <button
                    onClick={() => setHasExternalChange(false)}
                    className="px-3 py-1 text-xs bg-[var(--holo-border)]/50 hover:bg-[var(--holo-border)] rounded-md text-[var(--holo-muted)]"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          {sidebarOpen && (
            <DetailsSidebar onClose={() => setSidebarOpen(false)} />
          )}
        </div>
      </div>
    </ReactFlowProvider>
  );
}
