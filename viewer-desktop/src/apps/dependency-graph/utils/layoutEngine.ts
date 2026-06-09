/**
 * Layout Engine - Positions nodes for React Flow visualization
 *
 * Uses a simple force-directed-like approach optimized for dependency graphs
 */

import type { Node, Edge } from '@xyflow/react';
import type { DependencyGraph, DependencyNodeData } from '../types';

export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL';

interface LayoutOptions {
  direction: LayoutDirection;
  nodeWidth: number;
  nodeHeight: number;
  horizontalSpacing: number;
  verticalSpacing: number;
}

const DEFAULT_LAYOUT: LayoutOptions = {
  direction: 'LR',
  nodeWidth: 180,
  nodeHeight: 50,
  horizontalSpacing: 80,
  verticalSpacing: 40,
};

/**
 * Convert dependency graph to React Flow nodes and edges with layout
 */
export function layoutGraph(
  graph: DependencyGraph,
  options: Partial<LayoutOptions> = {}
): { nodes: Node<DependencyNodeData>[]; edges: Edge[] } {
  const opts = { ...DEFAULT_LAYOUT, ...options };

  // Build adjacency for depth calculation
  const nodeList = Array.from(graph.nodes.values());

  // Group nodes by depth
  const depthGroups = new Map<number, typeof nodeList>();
  for (const node of nodeList) {
    const depth = node.depth || 0;
    if (!depthGroups.has(depth)) {
      depthGroups.set(depth, []);
    }
    depthGroups.get(depth)!.push(node);
  }

  // Sort depths
  const depths = Array.from(depthGroups.keys()).sort((a, b) => a - b);

  // Position nodes
  const flowNodes: Node<DependencyNodeData>[] = [];
  const nodePositions = new Map<string, { x: number; y: number }>();

  for (let depthIdx = 0; depthIdx < depths.length; depthIdx++) {
    const depth = depths[depthIdx];
    const nodesAtDepth = depthGroups.get(depth)!;

    // Sort by name for consistent ordering
    nodesAtDepth.sort((a, b) => a.name.localeCompare(b.name));

    for (let nodeIdx = 0; nodeIdx < nodesAtDepth.length; nodeIdx++) {
      const node = nodesAtDepth[nodeIdx];

      // Calculate position based on direction
      let x: number, y: number;

      const mainAxis = depthIdx * (opts.nodeWidth + opts.horizontalSpacing);
      const crossAxis = nodeIdx * (opts.nodeHeight + opts.verticalSpacing);
      // Center the group
      const crossOffset = ((nodesAtDepth.length - 1) * (opts.nodeHeight + opts.verticalSpacing)) / 2;

      switch (opts.direction) {
        case 'TB':
          x = crossAxis - crossOffset;
          y = mainAxis;
          break;
        case 'BT':
          x = crossAxis - crossOffset;
          y = -mainAxis;
          break;
        case 'RL':
          x = -mainAxis;
          y = crossAxis - crossOffset;
          break;
        case 'LR':
        default:
          x = mainAxis;
          y = crossAxis - crossOffset;
          break;
      }

      nodePositions.set(node.id, { x, y });

      // Get color based on extension
      const color = getNodeColor(node.extension, node.isExternal, node.isEntryPoint);

      flowNodes.push({
        id: node.id,
        type: 'dependency',
        position: { x, y },
        data: {
          label: node.name,
          extension: node.extension,
          isExternal: node.isExternal,
          isEntryPoint: node.isEntryPoint,
          importCount: node.imports.length,
          importedByCount: node.importedBy.length,
          depth: node.depth,
        },
        style: {
          borderColor: color,
        },
      });
    }
  }

  // Create edges
  const flowEdges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    animated: edge.importType === 'dynamic',
    style: {
      stroke: edge.importType === 'dynamic' ? '#f59e0b' : '#64748b',
      strokeWidth: 1.5,
    },
    markerEnd: {
      type: 'arrowclosed' as const,
      color: edge.importType === 'dynamic' ? '#f59e0b' : '#64748b',
    },
  }));

  return { nodes: flowNodes, edges: flowEdges };
}

/**
 * Get node color based on file type
 */
function getNodeColor(extension: string, isExternal: boolean, isEntryPoint: boolean): string {
  if (isExternal) return '#6b7280'; // gray
  if (isEntryPoint) return '#22c55e'; // green

  switch (extension) {
    case 'tsx':
      return '#06b6d4'; // cyan
    case 'ts':
      return '#3b82f6'; // blue
    case 'jsx':
      return '#f97316'; // orange
    case 'js':
      return '#eab308'; // yellow
    default:
      return '#8b5cf6'; // purple
  }
}

/**
 * Calculate viewport to fit all nodes
 */
export function calculateFitView(
  nodes: Node[],
  padding = 50
): { x: number; y: number; zoom: number } {
  if (nodes.length === 0) {
    return { x: 0, y: 0, zoom: 1 };
  }

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;

  for (const node of nodes) {
    minX = Math.min(minX, node.position.x);
    maxX = Math.max(maxX, node.position.x + (DEFAULT_LAYOUT.nodeWidth || 180));
    minY = Math.min(minY, node.position.y);
    maxY = Math.max(maxY, node.position.y + (DEFAULT_LAYOUT.nodeHeight || 50));
  }

  const width = maxX - minX + padding * 2;
  const height = maxY - minY + padding * 2;

  // Assuming viewport of ~800x600
  const zoom = Math.min(1, Math.min(800 / width, 600 / height));

  return {
    x: -(minX - padding) * zoom,
    y: -(minY - padding) * zoom,
    zoom,
  };
}
