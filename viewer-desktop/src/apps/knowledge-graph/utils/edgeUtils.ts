import type { InternalNode } from '@xyflow/react';

// Circle radius for nodes (must match CustomNode)
export const CIRCLE_RADIUS = 20;

// Offset from node origin to circle center
// Circle is at the left of the node, vertically centered
export const CIRCLE_OFFSET = { x: CIRCLE_RADIUS, y: CIRCLE_RADIUS };

interface Point {
  x: number;
  y: number;
}

/**
 * Get the center point of a node's circle
 */
export function getCircleCenter(node: InternalNode): Point {
  return {
    x: node.internals.positionAbsolute.x + CIRCLE_OFFSET.x,
    y: node.internals.positionAbsolute.y + CIRCLE_OFFSET.y,
  };
}

/**
 * Calculate where a line from circle center to target intersects the circle boundary
 */
export function getCircleIntersection(
  circleCenter: Point,
  targetPoint: Point,
  radius: number = CIRCLE_RADIUS
): Point {
  const dx = targetPoint.x - circleCenter.x;
  const dy = targetPoint.y - circleCenter.y;
  const angle = Math.atan2(dy, dx);

  return {
    x: circleCenter.x + radius * Math.cos(angle),
    y: circleCenter.y + radius * Math.sin(angle),
  };
}

/**
 * Get edge parameters for floating edges between two nodes
 */
export function getEdgeParams(
  sourceNode: InternalNode,
  targetNode: InternalNode
): {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
} {
  const sourceCenter = getCircleCenter(sourceNode);
  const targetCenter = getCircleCenter(targetNode);

  // Calculate intersection points on both circles
  const sourceIntersection = getCircleIntersection(sourceCenter, targetCenter);
  const targetIntersection = getCircleIntersection(targetCenter, sourceCenter);

  return {
    sx: sourceIntersection.x,
    sy: sourceIntersection.y,
    tx: targetIntersection.x,
    ty: targetIntersection.y,
  };
}

/**
 * Calculate control points for a smooth bezier curve
 */
export function getBezierControlPoints(
  source: Point,
  target: Point
): { c1: Point; c2: Point } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Control point distance scales with edge length
  const controlDistance = Math.min(distance * 0.4, 100);

  // Angle from source to target
  const angle = Math.atan2(dy, dx);

  return {
    c1: {
      x: source.x + controlDistance * Math.cos(angle),
      y: source.y + controlDistance * Math.sin(angle),
    },
    c2: {
      x: target.x - controlDistance * Math.cos(angle),
      y: target.y - controlDistance * Math.sin(angle),
    },
  };
}
