/**
 * Hook for managing dependency graph state and operations
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { DependencyGraph, ScanOptions } from '../types';
import { buildDependencyGraph, getGraphStats } from '../utils/graphBuilder';
import { layoutGraph, type LayoutDirection } from '../utils/layoutEngine';
import type { Node, Edge } from '@xyflow/react';
import type { DependencyNodeData } from '../types';

interface UseDependencyGraphOptions {
  rootDir: string;
  readFile: (path: string) => Promise<string>;
  getAllFiles: () => Promise<string[]>;
  initialFile?: string;
}

interface UseDependencyGraphReturn {
  // Graph data
  nodes: Node<DependencyNodeData>[];
  edges: Edge[];
  graph: DependencyGraph | null;
  stats: ReturnType<typeof getGraphStats> | null;

  // State
  isLoading: boolean;
  error: string | null;
  selectedNodeId: string | null;
  layoutDirection: LayoutDirection;

  // Filter state
  showExternal: boolean;
  maxDepth: number;
  excludePatterns: string[];

  // Actions
  refresh: () => Promise<void>;
  selectNode: (nodeId: string | null) => void;
  setLayoutDirection: (direction: LayoutDirection) => void;
  setShowExternal: (show: boolean) => void;
  setMaxDepth: (depth: number) => void;
  setExcludePatterns: (patterns: string[]) => void;
  focusOnNode: (nodeId: string) => void;
  getNodeData: (nodeId: string) => (DependencyGraph['nodes'] extends Map<string, infer T> ? T : never) | undefined;
}

export function useDependencyGraph({
  rootDir,
  readFile,
  getAllFiles,
  initialFile,
}: UseDependencyGraphOptions): UseDependencyGraphReturn {
  // Core state
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Layout state
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>('LR');

  // Filter state
  const [showExternal, setShowExternal] = useState(false);
  const [maxDepth, setMaxDepth] = useState(10);
  const [excludePatterns, setExcludePatterns] = useState<string[]>([
    'node_modules',
    '.d.ts',
    '.test.',
    '.spec.',
    '__tests__',
  ]);

  // Computed layout
  const [nodes, setNodes] = useState<Node<DependencyNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [stats, setStats] = useState<ReturnType<typeof getGraphStats> | null>(null);

  // Track if we should focus after layout
  const focusNodeRef = useRef<string | null>(null);

  // Build scan options from filter state
  const getScanOptions = useCallback((): ScanOptions => {
    return {
      maxDepth,
      includeExternal: showExternal,
      excludePatterns: excludePatterns.map((p) => new RegExp(p)),
    };
  }, [maxDepth, showExternal, excludePatterns]);

  // Scan and build graph
  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const files = await getAllFiles();
      const newGraph = await buildDependencyGraph(
        rootDir,
        initialFile || null,
        files,
        readFile,
        getScanOptions()
      );

      setGraph(newGraph);
      setStats(getGraphStats(newGraph));

      // Layout the graph
      const { nodes: layoutNodes, edges: layoutEdges } = layoutGraph(newGraph, {
        direction: layoutDirection,
      });

      setNodes(layoutNodes);
      setEdges(layoutEdges);
    } catch (err) {
      console.error('Failed to build dependency graph:', err);
      setError(err instanceof Error ? err.message : 'Failed to scan dependencies');
    } finally {
      setIsLoading(false);
    }
  }, [rootDir, readFile, getAllFiles, initialFile, getScanOptions, layoutDirection]);

  // Re-layout when direction changes
  useEffect(() => {
    if (graph) {
      const { nodes: layoutNodes, edges: layoutEdges } = layoutGraph(graph, {
        direction: layoutDirection,
      });
      setNodes(layoutNodes);
      setEdges(layoutEdges);
    }
  }, [graph, layoutDirection]);

  // Re-scan when filters change
  useEffect(() => {
    if (graph) {
      // Debounce filter changes
      const timer = setTimeout(() => {
        refresh();
      }, 300);
      return () => clearTimeout(timer);
    }
    // Intentionally only re-run when filter values change; `graph`/`refresh`
    // are excluded to avoid re-triggering the debounce on every rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExternal, maxDepth, excludePatterns]);

  // Initial scan
  useEffect(() => {
    refresh();
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Select a node
  const selectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  // Focus on a specific node (center view)
  const focusOnNode = useCallback((nodeId: string) => {
    focusNodeRef.current = nodeId;
    setSelectedNodeId(nodeId);
  }, []);

  // Get node data by ID
  const getNodeData = useCallback(
    (nodeId: string) => {
      return graph?.nodes.get(nodeId);
    },
    [graph]
  );

  return {
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
    focusOnNode,
    getNodeData,
  };
}
