import type { WindowState } from '../types';

export interface SnapResult {
  x: number;
  y: number;
  snapped: boolean;
  snapType?: 'edge' | 'window' | 'center';
}

export interface ContainerSize {
  width: number;
  height: number;
}

export function calculateSnap(
  window: WindowState,
  _allWindows: WindowState[],  // Reserved for future window-to-window snapping
  containerSize: ContainerSize,
  snapDistance: number = 10
): SnapResult {
  let x = window.position.x;
  let y = window.position.y;
  let snapped = false;
  let snapType: 'edge' | 'window' | 'center' | undefined;

  const windowRight = x + window.size.width;
  const windowBottom = y + window.size.height;

  // Check screen edges only
  // Left edge
  if (Math.abs(x) < snapDistance) {
    x = 0;
    snapped = true;
    snapType = 'edge';
  }

  // Right edge
  if (Math.abs(windowRight - containerSize.width) < snapDistance) {
    x = containerSize.width - window.size.width;
    snapped = true;
    snapType = 'edge';
  }

  // Top edge
  if (Math.abs(y) < snapDistance) {
    y = 0;
    snapped = true;
    snapType = 'edge';
  }

  // Bottom edge
  if (Math.abs(windowBottom - containerSize.height) < snapDistance) {
    y = containerSize.height - window.size.height;
    snapped = true;
    snapType = 'edge';
  }

  return { x, y, snapped, snapType };
}
