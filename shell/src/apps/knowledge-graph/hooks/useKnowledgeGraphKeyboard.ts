import { useEffect, useCallback } from 'react';
import type { GraphNode } from '../types';

interface UseKnowledgeGraphKeyboardProps {
  isActive: boolean;
  nodes: GraphNode[];
  selectedNodeIds: string[];  // Array for stable reference comparison
  edgeCreationMode: boolean;
  sidebarOpen: boolean;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;
  onEnterEdgeMode: () => void;
  onExitEdgeMode: () => void;
  onCloseSidebar: () => void;
}

// Calculate distance between two positions
function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}

// Find nearest node in a given direction
function findNearestInDirection(
  currentPos: { x: number; y: number },
  nodes: GraphNode[],
  currentId: string,
  direction: 'up' | 'down' | 'left' | 'right'
): GraphNode | null {
  // Filter nodes that are in the correct direction
  const candidates = nodes.filter((n) => {
    if (n.id === currentId) return false;

    const dx = n.position.x - currentPos.x;
    const dy = n.position.y - currentPos.y;

    // Determine if node is in the right direction
    // Use a 45-degree cone for each direction
    switch (direction) {
      case 'up':
        return dy < 0 && Math.abs(dx) < Math.abs(dy);
      case 'down':
        return dy > 0 && Math.abs(dx) < Math.abs(dy);
      case 'left':
        return dx < 0 && Math.abs(dy) < Math.abs(dx);
      case 'right':
        return dx > 0 && Math.abs(dy) < Math.abs(dx);
      default:
        return false;
    }
  });

  if (candidates.length === 0) return null;

  // Find the closest candidate
  let closest = candidates[0];
  let closestDist = distance(currentPos, closest.position);

  for (let i = 1; i < candidates.length; i++) {
    const d = distance(currentPos, candidates[i].position);
    if (d < closestDist) {
      closest = candidates[i];
      closestDist = d;
    }
  }

  return closest;
}

export function useKnowledgeGraphKeyboard({
  isActive,
  nodes,
  selectedNodeIds,
  edgeCreationMode,
  sidebarOpen,
  onSelectNode,
  onClearSelection,
  onEnterEdgeMode,
  onExitEdgeMode,
  onCloseSidebar,
}: UseKnowledgeGraphKeyboardProps) {

  const navigateToNode = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    if (nodes.length === 0) return;

    // Get currently selected node (now using array)
    const selectedId = selectedNodeIds[0];
    const currentNode = selectedId ? nodes.find((n) => n.id === selectedId) : null;

    if (!currentNode) {
      // No node selected, select the first one (or center-most)
      const centerNode = nodes.reduce((closest, node) => {
        const distToCurrent = Math.abs(node.position.x) + Math.abs(node.position.y);
        const distToClosest = Math.abs(closest.position.x) + Math.abs(closest.position.y);
        return distToCurrent < distToClosest ? node : closest;
      });
      onSelectNode(centerNode.id);
      return;
    }

    // Find nearest node in the specified direction
    const nearestNode = findNearestInDirection(currentNode.position, nodes, currentNode.id, direction);

    if (nearestNode) {
      onSelectNode(nearestNode.id);
    }
  }, [nodes, selectedNodeIds, onSelectNode]);

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in input/textarea
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (target.closest('[contenteditable="true"]')) return;
      if (target.closest('.ProseMirror')) return;

      // Handle Escape - multiple contexts
      if (e.key === 'Escape') {
        if (edgeCreationMode) {
          e.preventDefault();
          onExitEdgeMode();
        } else if (sidebarOpen) {
          e.preventDefault();
          onCloseSidebar();
        } else if (selectedNodeIds.length > 0) {
          e.preventDefault();
          onClearSelection();
        }
        return;
      }

      // Don't intercept Cmd/Ctrl+Arrow for window navigation
      if ((e.metaKey || e.ctrlKey) &&
          ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        return;
      }

      switch (e.key) {
        case 'e':
        case 'E':
          // E to enter edge creation mode
          if (!edgeCreationMode && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            onEnterEdgeMode();
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          navigateToNode('up');
          break;

        case 'ArrowDown':
          e.preventDefault();
          navigateToNode('down');
          break;

        case 'ArrowLeft':
          e.preventDefault();
          navigateToNode('left');
          break;

        case 'ArrowRight':
          e.preventDefault();
          navigateToNode('right');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isActive,
    selectedNodeIds,
    edgeCreationMode,
    sidebarOpen,
    navigateToNode,
    onEnterEdgeMode,
    onExitEdgeMode,
    onCloseSidebar,
    onClearSelection,
  ]);
}
