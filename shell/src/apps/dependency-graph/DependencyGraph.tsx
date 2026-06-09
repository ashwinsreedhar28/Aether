/**
 * Dependency Graph App
 *
 * Visualizes import relationships between files in a codebase
 */

import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type OnNodesChange,
  type OnEdgesChange,
  type NodeMouseHandler,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { AppProps } from '../types';
import { useAppContext } from '../AppContext';
import { useFileSystemStore } from '../../stores/fileSystemStore';
import { useDependencyGraph } from './hooks/useDependencyGraph';
import { DependencyNode } from './components/DependencyNode';
import { Toolbar } from './components/Toolbar';
import { FilterPanel } from './components/FilterPanel';
import { NodeDetails } from './components/NodeDetails';
import type { DependencyNodeData } from './types';

// Register custom node types
const nodeTypes = {
  dependency: DependencyNode,
};

function DependencyGraphInner({ isActive }: AppProps) {
  const { openFile } = useAppContext();
  const rootDir = useFileSystemStore((s) => s.rootDir);
  const reactFlowInstance = useReactFlow();

  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Collect all file paths from tree
  const getAllFiles = useCallback(async (): Promise<string[]> => {
    const files: string[] = [];

    const traverse = async (dirPath: string): Promise<void> => {
      try {
        const { children } = await window.electron.fs.getChildren(dirPath, { showHidden: false });
        for (const child of children) {
          if (child.type === 'file') {
            files.push(child.path);
          } else if (child.type === 'directory' && !child.name.startsWith('.') && child.name !== 'node_modules') {
            await traverse(child.path);
          }
        }
      } catch (err) {
        console.warn(`Failed to read directory ${dirPath}:`, err);
      }
    };

    if (rootDir) {
      await traverse(rootDir);
    }

    return files;
  }, [rootDir]);

  // Read file content
  const readFile = useCallback(async (path: string): Promise<string> => {
    const { content } = await window.electron.fs.readFile(path);
    return content;
  }, []);

  // Use dependency graph hook
  const {
    nodes,
    edges,
    graph,
    stats,
    isLoading,
    error,
    selectedNodeId,
    layoutDirection,
    showExternal,
    maxDepth,
    excludePatterns,
    refresh,
    selectNode,
    setLayoutDirection,
    setShowExternal,
    setMaxDepth,
    setExcludePatterns,
    getNodeData,
  } = useDependencyGraph({
    rootDir: rootDir || '',
    readFile,
    getAllFiles,
  });

  // Local nodes/edges state for React Flow interactivity
  const [localNodes, setLocalNodes] = useState(nodes);
  const [localEdges, setLocalEdges] = useState(edges);

  // Sync local React Flow state when the computed graph updates.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalNodes(nodes);
    setLocalEdges(edges);
  }, [nodes, edges]);

  // Handle node changes (dragging, selection)
  const onNodesChange: OnNodesChange<Node<DependencyNodeData>> = useCallback(
    (changes) => setLocalNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setLocalEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  // Handle node click
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      selectNode(node.id);
    },
    [selectNode]
  );

  // Handle node double-click (open file)
  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const nodeData = getNodeData(node.id);
      if (nodeData && !nodeData.isExternal) {
        openFile(nodeData.absolutePath);
      }
    },
    [getNodeData, openFile]
  );

  // Handle background click (deselect)
  const onPaneClick = useCallback(() => {
    selectNode(null);
    setShowFilterPanel(false);
  }, [selectNode]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    reactFlowInstance.zoomIn();
  }, [reactFlowInstance]);

  const handleZoomOut = useCallback(() => {
    reactFlowInstance.zoomOut();
  }, [reactFlowInstance]);

  const handleFitView = useCallback(() => {
    reactFlowInstance.fitView({ padding: 0.2, duration: 300 });
  }, [reactFlowInstance]);

  // Navigate to node in graph
  const handleNavigateToNode = useCallback(
    (nodeId: string) => {
      selectNode(nodeId);

      // Find the node and center on it
      const node = localNodes.find((n) => n.id === nodeId);
      if (node) {
        reactFlowInstance.setCenter(
          node.position.x + 90, // center of node
          node.position.y + 25,
          { duration: 300, zoom: 1 }
        );
      }
    },
    [localNodes, reactFlowInstance, selectNode]
  );

  // Open file in editor
  const handleOpenFile = useCallback(
    (path: string) => {
      openFile(path);
    },
    [openFile]
  );

  // Selected node data
  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !graph) return null;
    return graph.nodes.get(selectedNodeId);
  }, [selectedNodeId, graph]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        selectNode(null);
        setShowFilterPanel(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        refresh();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, selectNode, refresh]);

  // No workspace open
  if (!rootDir) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[var(--holo-bg)]">
        <div className="text-center text-[var(--holo-muted)]">
          <p className="text-lg mb-2">No workspace open</p>
          <p className="text-sm">Open a folder to visualize dependencies</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[var(--holo-bg)]">
        <div className="text-center">
          <p className="text-red-400 mb-2">Failed to scan dependencies</p>
          <p className="text-sm text-[var(--holo-muted)]">{error}</p>
          <button
            onClick={refresh}
            className="mt-4 px-4 py-2 rounded bg-[var(--holo-accent)]/20 hover:bg-[var(--holo-accent)]/30 text-[var(--holo-accent)] text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full flex flex-col bg-[var(--holo-bg)]">
      {/* Toolbar */}
      <Toolbar
        onRefresh={refresh}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitView={handleFitView}
        onToggleFilter={() => setShowFilterPanel(!showFilterPanel)}
        direction={layoutDirection}
        onDirectionChange={setLayoutDirection}
        isLoading={isLoading}
        stats={stats}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Filter panel */}
        {showFilterPanel && (
          <FilterPanel
            onClose={() => setShowFilterPanel(false)}
            showExternal={showExternal}
            onToggleExternal={setShowExternal}
            maxDepth={maxDepth}
            onMaxDepthChange={setMaxDepth}
            excludePatterns={excludePatterns}
            onExcludePatternsChange={setExcludePatterns}
          />
        )}

        {/* React Flow canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={localNodes}
            edges={localEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            className="bg-[var(--holo-bg)]"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="var(--holo-border)"
            />
            <Controls
              showZoom={false}
              showFitView={false}
              showInteractive={false}
              className="!bg-[var(--holo-bg)] !border-[var(--holo-border)] !shadow-none [&>button]:!bg-[var(--holo-bg)] [&>button]:!border-[var(--holo-border)] [&>button]:!text-[var(--holo-muted)] [&>button:hover]:!bg-[var(--holo-border)]/50"
            />
          </ReactFlow>

          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 bg-[var(--holo-bg)]/80 flex items-center justify-center">
              <div className="flex items-center gap-3 text-[var(--holo-muted)]">
                <div className="w-5 h-5 border-2 border-[var(--holo-accent)] border-t-transparent rounded-full animate-spin" />
                <span>Scanning dependencies...</span>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && localNodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center text-[var(--holo-muted)]">
                <p className="text-lg mb-2">No dependencies found</p>
                <p className="text-sm">This workspace has no JS/TS files to analyze</p>
              </div>
            </div>
          )}
        </div>

        {/* Node details sidebar */}
        {selectedNode && (
          <NodeDetails
            node={selectedNode}
            onClose={() => selectNode(null)}
            onNavigate={handleNavigateToNode}
            onOpenFile={handleOpenFile}
          />
        )}
      </div>
    </div>
  );
}

// Wrap with ReactFlowProvider
export function DependencyGraph(props: AppProps) {
  return (
    <ReactFlowProvider>
      <DependencyGraphInner {...props} />
    </ReactFlowProvider>
  );
}
