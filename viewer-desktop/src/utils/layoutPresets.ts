import type { WindowState } from '../types';

export type LayoutPreset = 'focus' | 'split' | 'thirds' | 'quarters';

export interface PresetLayout {
  windowId: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface ContainerSize {
  width: number;
  height: number;
}

const GAP = 8;

/**
 * Calculate Focus layout: one primary window takes most of the space,
 * others stack vertically on the side
 */
function calculateFocusLayout(
  windows: WindowState[],
  container: ContainerSize,
  focusedWindowId?: string
): PresetLayout[] {
  if (windows.length === 0) return [];

  if (windows.length === 1) {
    return [{
      windowId: windows[0].id,
      position: { x: GAP, y: GAP },
      size: {
        width: container.width - GAP * 2,
        height: container.height - GAP * 2
      },
    }];
  }

  // Find focused window or use first
  const focusedIdx = focusedWindowId
    ? windows.findIndex(w => w.id === focusedWindowId)
    : 0;
  const primaryIdx = focusedIdx >= 0 ? focusedIdx : 0;

  // Primary window gets 70% of width
  const primaryWidth = Math.round((container.width - GAP * 3) * 0.7);
  const sideWidth = container.width - primaryWidth - GAP * 3;

  const layouts: PresetLayout[] = [];

  // Primary window
  layouts.push({
    windowId: windows[primaryIdx].id,
    position: { x: GAP, y: GAP },
    size: {
      width: primaryWidth,
      height: container.height - GAP * 2
    },
  });

  // Side windows stack vertically
  const sideWindows = windows.filter((_, i) => i !== primaryIdx);
  const sideHeight = (container.height - GAP * (sideWindows.length + 1)) / sideWindows.length;

  sideWindows.forEach((win, i) => {
    layouts.push({
      windowId: win.id,
      position: {
        x: primaryWidth + GAP * 2,
        y: GAP + i * (sideHeight + GAP)
      },
      size: {
        width: sideWidth,
        height: sideHeight
      },
    });
  });

  return layouts;
}

/**
 * Calculate Split layout: 2 windows side by side (50/50),
 * extra windows stack below
 */
function calculateSplitLayout(
  windows: WindowState[],
  container: ContainerSize
): PresetLayout[] {
  if (windows.length === 0) return [];

  if (windows.length === 1) {
    return [{
      windowId: windows[0].id,
      position: { x: GAP, y: GAP },
      size: {
        width: container.width - GAP * 2,
        height: container.height - GAP * 2
      },
    }];
  }

  const layouts: PresetLayout[] = [];
  const halfWidth = (container.width - GAP * 3) / 2;

  if (windows.length === 2) {
    // Perfect 50/50 split
    layouts.push({
      windowId: windows[0].id,
      position: { x: GAP, y: GAP },
      size: { width: halfWidth, height: container.height - GAP * 2 },
    });
    layouts.push({
      windowId: windows[1].id,
      position: { x: halfWidth + GAP * 2, y: GAP },
      size: { width: halfWidth, height: container.height - GAP * 2 },
    });
  } else {
    // Top row: 2 windows, remaining stack below
    const topHeight = Math.round((container.height - GAP * 3) * 0.6);
    const bottomHeight = container.height - topHeight - GAP * 3;

    layouts.push({
      windowId: windows[0].id,
      position: { x: GAP, y: GAP },
      size: { width: halfWidth, height: topHeight },
    });
    layouts.push({
      windowId: windows[1].id,
      position: { x: halfWidth + GAP * 2, y: GAP },
      size: { width: halfWidth, height: topHeight },
    });

    // Bottom windows
    const bottomWindows = windows.slice(2);
    const bottomWidth = (container.width - GAP * (bottomWindows.length + 1)) / bottomWindows.length;

    bottomWindows.forEach((win, i) => {
      layouts.push({
        windowId: win.id,
        position: {
          x: GAP + i * (bottomWidth + GAP),
          y: topHeight + GAP * 2
        },
        size: { width: bottomWidth, height: bottomHeight },
      });
    });
  }

  return layouts;
}

/**
 * Calculate Thirds layout: 3 equal columns
 */
function calculateThirdsLayout(
  windows: WindowState[],
  container: ContainerSize
): PresetLayout[] {
  if (windows.length === 0) return [];

  if (windows.length === 1) {
    // Center the single window in the middle third
    const thirdWidth = (container.width - GAP * 4) / 3;
    return [{
      windowId: windows[0].id,
      position: { x: thirdWidth + GAP * 2, y: GAP },
      size: {
        width: thirdWidth,
        height: container.height - GAP * 2
      },
    }];
  }

  if (windows.length === 2) {
    // Two windows take left 2/3 and right 1/3
    const twoThirds = Math.round((container.width - GAP * 3) * 0.67);
    const oneThird = container.width - twoThirds - GAP * 3;

    return [
      {
        windowId: windows[0].id,
        position: { x: GAP, y: GAP },
        size: { width: twoThirds, height: container.height - GAP * 2 },
      },
      {
        windowId: windows[1].id,
        position: { x: twoThirds + GAP * 2, y: GAP },
        size: { width: oneThird, height: container.height - GAP * 2 },
      },
    ];
  }

  const layouts: PresetLayout[] = [];
  const thirdWidth = (container.width - GAP * 4) / 3;

  // First 3 windows get full height columns
  for (let i = 0; i < Math.min(3, windows.length); i++) {
    layouts.push({
      windowId: windows[i].id,
      position: { x: GAP + i * (thirdWidth + GAP), y: GAP },
      size: {
        width: thirdWidth,
        height: container.height - GAP * 2
      },
    });
  }

  // Extra windows: split the columns vertically
  if (windows.length > 3) {
    const extras = windows.slice(3);
    const colHeight = (container.height - GAP * 3) / 2;

    // Resize first window to half height
    layouts[0].size.height = colHeight;

    extras.forEach((win, i) => {
      const targetCol = i % 3;
      if (i < 3) {
        // Second row
        layouts.push({
          windowId: win.id,
          position: {
            x: GAP + targetCol * (thirdWidth + GAP),
            y: colHeight + GAP * 2
          },
          size: { width: thirdWidth, height: colHeight },
        });
        // Resize the window above if it exists
        if (targetCol < layouts.length) {
          layouts[targetCol].size.height = colHeight;
        }
      }
    });
  }

  return layouts;
}

/**
 * Calculate Quarters layout: 2x2 grid
 */
function calculateQuartersLayout(
  windows: WindowState[],
  container: ContainerSize
): PresetLayout[] {
  if (windows.length === 0) return [];

  const halfWidth = (container.width - GAP * 3) / 2;
  const halfHeight = (container.height - GAP * 3) / 2;

  if (windows.length === 1) {
    return [{
      windowId: windows[0].id,
      position: { x: GAP, y: GAP },
      size: { width: halfWidth, height: halfHeight },
    }];
  }

  const positions = [
    { x: GAP, y: GAP }, // top-left
    { x: halfWidth + GAP * 2, y: GAP }, // top-right
    { x: GAP, y: halfHeight + GAP * 2 }, // bottom-left
    { x: halfWidth + GAP * 2, y: halfHeight + GAP * 2 }, // bottom-right
  ];

  const layouts: PresetLayout[] = [];

  for (let i = 0; i < Math.min(4, windows.length); i++) {
    layouts.push({
      windowId: windows[i].id,
      position: positions[i],
      size: { width: halfWidth, height: halfHeight },
    });
  }

  // Extra windows beyond 4: subdivide quadrants
  if (windows.length > 4) {
    const extras = windows.slice(4);
    const quarterWidth = (halfWidth - GAP) / 2;

    extras.forEach((win, i) => {
      const quadrant = i % 4;
      const basePos = positions[quadrant];
      // Place in right half of the quadrant
      layouts.push({
        windowId: win.id,
        position: {
          x: basePos.x + quarterWidth + GAP,
          y: basePos.y
        },
        size: { width: quarterWidth, height: halfHeight },
      });
      // Shrink the original window in that quadrant
      if (quadrant < layouts.length - extras.length) {
        layouts[quadrant].size.width = quarterWidth;
      }
    });
  }

  return layouts;
}

/**
 * Main entry point: calculate layout for a given preset
 */
export function calculatePresetLayout(
  preset: LayoutPreset,
  windows: WindowState[],
  containerSize: ContainerSize,
  focusedWindowId?: string
): PresetLayout[] {
  // Filter out minimized windows
  const visibleWindows = windows.filter(w => !w.isMinimized);

  if (visibleWindows.length === 0) return [];

  switch (preset) {
    case 'focus':
      return calculateFocusLayout(visibleWindows, containerSize, focusedWindowId);
    case 'split':
      return calculateSplitLayout(visibleWindows, containerSize);
    case 'thirds':
      return calculateThirdsLayout(visibleWindows, containerSize);
    case 'quarters':
      return calculateQuartersLayout(visibleWindows, containerSize);
    default:
      return [];
  }
}

/**
 * Get human-readable name for preset
 */
export function getPresetName(preset: LayoutPreset): string {
  switch (preset) {
    case 'focus': return 'Focus';
    case 'split': return 'Split';
    case 'thirds': return 'Thirds';
    case 'quarters': return 'Quarters';
    default: return preset;
  }
}
