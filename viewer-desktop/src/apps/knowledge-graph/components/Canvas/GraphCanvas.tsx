import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  BackgroundVariant,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { CustomNode } from './CustomNode';
import { FloatingEdge } from './FloatingEdge';
import { EdgeLabelInput } from './EdgeLabelInput';
import { useGraphStore } from '../../store/graphStore';
import type { GraphNode } from '../../types';

const nodeTypes = { custom: CustomNode };
const edgeTypes = { floating: FloatingEdge };

interface GraphCanvasProps {
  onNodeContextMenu?: (event: React.MouseEvent, node: Node) => void;
  onCanvasContextMenu?: (event: React.MouseEvent) => void;
  /** Host window id, used to report node-drag interactions back to the opening agent. */
  windowId?: string;
}

// Pending edge awaiting label input
interface PendingEdge {
  id: string;
  source: string;
  target: string;
  sourcePos: { x: number; y: number };
  targetPos: { x: number; y: number };
}

export function GraphCanvas({ onNodeContextMenu, onCanvasContextMenu, windowId }: GraphCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [pendingEdge, setPendingEdge] = useState<PendingEdge | null>(null);

  // Store state
  const storeNodes = useGraphStore((s) => s.nodes);
  const storeEdges = useGraphStore((s) => s.edges);
  const settings = useGraphStore((s) => s.settings);
  const searchQuery = useGraphStore((s) => s.searchQuery);
  const viewport = useGraphStore((s) => s.viewport);
  const edgeCreationMode = useGraphStore((s) => s.edgeCreationMode);
  const edgeCreationSource = useGraphStore((s) => s.edgeCreationSource);

  // Store actions
  const setSelectedNodes = useGraphStore((s) => s.setSelectedNodes);
  const clearSelection = useGraphStore((s) => s.clearSelection);
  const storeAddNode = useGraphStore((s) => s.addNode);
  const storeUpdateNode = useGraphStore((s) => s.updateNode);
  const storeDeleteNode = useGraphStore((s) => s.deleteNode);
  const storeAddEdge = useGraphStore((s) => s.addEdge);
  const storeDeleteEdge = useGraphStore((s) => s.deleteEdge);
  const storeUpdateEdge = useGraphStore((s) => s.updateEdge);
  const setViewport = useGraphStore((s) => s.setViewport);
  const setEditingNode = useGraphStore((s) => s.setEditingNode);
  const setEdgeCreationMode = useGraphStore((s) => s.setEdgeCreationMode);
  const setEdgeCreationSource = useGraphStore((s) => s.setEdgeCreationSource);

  // Convert store nodes to React Flow nodes
  // Note: We don't set `selected` here - React Flow manages selection internally
  // We sync selection back to our store via onSelectionChange callback
  const flowNodes: Node[] = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return storeNodes.map((node) => ({
      id: node.id,
      type: 'custom',
      position: node.position,
      dragHandle: '.drag-handle', // Drag from entire node
      data: {
        ...node,
        isSearchMatch: query && (
          node.title.toLowerCase().includes(query) ||
          node.body.toLowerCase().includes(query) ||
          node.tags?.some((t) => t.toLowerCase().includes(query))
        ),
        isEdgeSource: edgeCreationMode && edgeCreationSource === node.id,
      },
    }));
  }, [storeNodes, searchQuery, edgeCreationMode, edgeCreationSource]);

  // Convert store edges to React Flow edges
  const flowEdges: Edge[] = useMemo(() => {
    return storeEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'floating',
      data: { ...edge },
    }));
  }, [storeEdges]);

  // Handle node position changes
  // Note: Selection is handled by onSelectionChange, not here
  const handleNodesChange: OnNodesChange = useCallback((changes) => {
    changes.forEach((change) => {
      if (change.type === 'position' && change.position) {
        storeUpdateNode(change.id, { position: change.position });
      } else if (change.type === 'remove') {
        storeDeleteNode(change.id);
      }
      // Selection changes are handled by onSelectionChange callback
    });
  }, [storeUpdateNode, storeDeleteNode]);

  // Human→agent feedback: when the user finishes dragging a node, report the
  // final position back to the agent that opened this view. Mirrors the kanban
  // card_moved pattern. Fire-and-forget — a failed emit must never disrupt the
  // local graph; emit only on drag *stop* (not per-frame position change).
  const handleNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    if (!windowId) return;
    void window.electron?.control
      ?.emitViewEvent(windowId, 'node_moved', {
        nodeId: node.id,
        position: node.position,
      })
      .catch(() => {});
  }, [windowId]);

  // Handle selection changes from React Flow
  const handleSelectionChange = useCallback(({ nodes }: { nodes: Node[] }) => {
    const selectedIds = nodes.map((n) => n.id);
    setSelectedNodes(selectedIds);
  }, [setSelectedNodes]);

  // Handle edge changes
  const handleEdgesChange: OnEdgesChange = useCallback((changes) => {
    changes.forEach((change) => {
      if (change.type === 'remove') {
        storeDeleteEdge(change.id);
      }
    });
  }, [storeDeleteEdge]);

  // Handle canvas click (deselect)
  const handlePaneClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  // Handle node click - either edge creation or open sidebar
  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (edgeCreationMode) {
      if (!edgeCreationSource) {
        // First click - set source node
        setEdgeCreationSource(node.id);
        setSelectedNodes([node.id]);
      } else if (edgeCreationSource !== node.id) {
        // Second click - create edge and show label input
        const sourceNode = storeNodes.find((n) => n.id === edgeCreationSource);
        const targetNode = storeNodes.find((n) => n.id === node.id);

        if (sourceNode && targetNode) {
          // Create the edge
          const edgeId = storeAddEdge({
            source: edgeCreationSource,
            target: node.id,
            type: settings.defaultEdgeType,
          });

          // Show label input at edge center
          setPendingEdge({
            id: edgeId,
            source: edgeCreationSource,
            target: node.id,
            sourcePos: sourceNode.position,
            targetPos: targetNode.position,
          });

          // Exit edge creation mode
          setEdgeCreationMode(false);
          setEdgeCreationSource(null);
          clearSelection();
        }
      }
    } else {
      // Normal click - open sidebar
      setEditingNode(node.id);
    }
  }, [
    edgeCreationMode,
    edgeCreationSource,
    storeNodes,
    settings.defaultEdgeType,
    setEdgeCreationSource,
    setSelectedNodes,
    storeAddEdge,
    setEdgeCreationMode,
    clearSelection,
    setEditingNode,
  ]);

  // Handle label save for pending edge
  const handleEdgeLabelSave = useCallback((label: string) => {
    if (pendingEdge && label.trim()) {
      storeUpdateEdge(pendingEdge.id, { label: label.trim() });
    }
    setPendingEdge(null);
  }, [pendingEdge, storeUpdateEdge]);

  // Handle label cancel
  const handleEdgeLabelCancel = useCallback(() => {
    setPendingEdge(null);
  }, []);

  // Handle double-click on canvas (create node)
  const handlePaneDoubleClick = useCallback((event: React.MouseEvent) => {
    if (!reactFlowWrapper.current) return;

    const bounds = reactFlowWrapper.current.getBoundingClientRect();
    const position = {
      x: (event.clientX - bounds.left - viewport.x) / viewport.zoom,
      y: (event.clientY - bounds.top - viewport.y) / viewport.zoom,
    };

    const newNodeId = storeAddNode({
      position,
      type: settings.defaultNodeType,
      title: 'New Node',
      body: '',
    });

    setSelectedNodes([newNodeId]);
    setEditingNode(newNodeId);
  }, [viewport, storeAddNode, settings.defaultNodeType, setSelectedNodes, setEditingNode]);

  // Handle viewport change
  const handleMoveEnd = useCallback((_: unknown, vp: { x: number; y: number; zoom: number }) => {
    setViewport(vp);
  }, [setViewport]);

  return (
    <div ref={reactFlowWrapper} className="w-full h-full">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onNodeDragStop={handleNodeDragStop}
        onEdgesChange={handleEdgesChange}
        onSelectionChange={handleSelectionChange}
        onPaneClick={handlePaneClick}
        onNodeClick={handleNodeClick}
        onDoubleClick={handlePaneDoubleClick}
        onMoveEnd={handleMoveEnd}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onCanvasContextMenu as ((event: MouseEvent | React.MouseEvent) => void) | undefined}
        defaultViewport={viewport}
        snapToGrid={settings.snapToGrid}
        snapGrid={[settings.gridSize, settings.gridSize]}
        fitView={storeNodes.length > 0}
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode="Shift"
        panActivationKeyCode={null}
        selectionOnDrag
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        className="bg-transparent"
        proOptions={{ hideAttribution: true }}
      >
        {settings.showGrid && (
          <Background
            variant={BackgroundVariant.Dots}
            gap={settings.gridSize}
            size={1}
            color="rgba(100, 150, 255, 0.1)"
          />
        )}

        <Controls
          className="!bg-[var(--holo-bg)]/80 !border-[var(--holo-border)] !rounded-lg !shadow-lg"
          showZoom
          showFitView
          showInteractive={false}
        />

        {settings.showMinimap && (
          <MiniMap
            className="!bg-[var(--holo-bg)]/80 !border-[var(--holo-border)] !rounded-lg"
            nodeColor={(node) => {
              const data = node.data as unknown as GraphNode;
              return data.color || '#60a5fa';
            }}
            maskColor="rgba(0, 0, 0, 0.7)"
            pannable
            zoomable
          />
        )}

        {/* Stats panel */}
        <Panel position="top-right" className="!m-0">
          <div className="px-3 py-2 text-xs text-[var(--holo-muted)] bg-[var(--holo-bg)]/70 border border-[var(--holo-border)] rounded-lg backdrop-blur-sm">
            {storeNodes.length} nodes · {storeEdges.length} edges · {Math.round(viewport.zoom * 100)}%
          </div>
        </Panel>

        {/* Edge creation mode indicator */}
        {edgeCreationMode && (
          <Panel position="top-center" className="!m-0 !mt-2">
            <div className="px-4 py-2 text-sm text-cyan-300 bg-cyan-500/20 border border-cyan-500/40 rounded-lg backdrop-blur-sm">
              {edgeCreationSource
                ? 'Click target node to create edge'
                : 'Click source node to start edge'}
              <span className="ml-2 text-cyan-400/60">(Esc to cancel)</span>
            </div>
          </Panel>
        )}
      </ReactFlow>

      {/* Edge label input */}
      {pendingEdge && (
        <EdgeLabelInput
          sourcePos={pendingEdge.sourcePos}
          targetPos={pendingEdge.targetPos}
          viewport={viewport}
          onSave={handleEdgeLabelSave}
          onCancel={handleEdgeLabelCancel}
        />
      )}
    </div>
  );
}
