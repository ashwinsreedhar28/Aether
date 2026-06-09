import type { WindowState } from '../types';

export interface TileLayout {
  windowId: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface ContainerSize {
  width: number;
  height: number;
}

// How much extra space the focused window gets (as a ratio)
const FOCUS_EXPANSION_RATIO = 0.15; // 15% larger

/**
 * Calculates optimal grid dimensions for a given number of windows
 */
function calculateGridDimensions(count: number): { cols: number; rows: number } {
  if (count === 0) return { cols: 0, rows: 0 };
  if (count === 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count === 3) return { cols: 3, rows: 1 };

  // For 4+ windows, try to make a balanced grid
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  return { cols, rows };
}

/**
 * Calculates tile layout positions and sizes for all windows
 * If focusedWindowId is provided, that window will be slightly larger
 */
export function calculateTileLayout(
  windows: WindowState[],
  containerSize: ContainerSize,
  gap: number = 8,
  focusedWindowId?: string
): TileLayout[] {
  // Filter out minimized windows
  const tilableWindows = windows.filter(w => !w.isMinimized);

  if (tilableWindows.length === 0) {
    return [];
  }

  // For single window, no expansion effect needed
  if (tilableWindows.length === 1) {
    const win = tilableWindows[0];
    return [{
      windowId: win.id,
      position: { x: gap, y: gap },
      size: {
        width: Math.round(containerSize.width - 2 * gap),
        height: Math.round(containerSize.height - 2 * gap),
      },
    }];
  }

  const { cols, rows } = calculateGridDimensions(tilableWindows.length);

  // Find focused window index
  const focusedIndex = focusedWindowId
    ? tilableWindows.findIndex(w => w.id === focusedWindowId)
    : -1;
  const focusedCol = focusedIndex >= 0 ? focusedIndex % cols : -1;
  const focusedRow = focusedIndex >= 0 ? Math.floor(focusedIndex / cols) : -1;

  // Calculate base cell dimensions with gaps
  const totalGapWidth = (cols + 1) * gap;
  const totalGapHeight = (rows + 1) * gap;
  const baseCellWidth = (containerSize.width - totalGapWidth) / cols;
  const baseCellHeight = (containerSize.height - totalGapHeight) / rows;

  // Calculate expansion amounts - only expand in dimensions where there are multiple cells to redistribute from
  const expansionWidth = focusedIndex >= 0 && cols > 1 ? baseCellWidth * FOCUS_EXPANSION_RATIO : 0;
  const expansionHeight = focusedIndex >= 0 && rows > 1 ? baseCellHeight * FOCUS_EXPANSION_RATIO : 0;

  // Calculate shrink amounts for other cells
  // Total expansion needs to be distributed among other columns/rows
  const shrinkWidthPerCol = focusedIndex >= 0 && cols > 1
    ? expansionWidth / (cols - 1)
    : 0;
  const shrinkHeightPerRow = focusedIndex >= 0 && rows > 1
    ? expansionHeight / (rows - 1)
    : 0;

  // Calculate column widths
  const colWidths: number[] = [];
  for (let c = 0; c < cols; c++) {
    if (c === focusedCol) {
      colWidths.push(baseCellWidth + expansionWidth);
    } else if (focusedIndex >= 0) {
      colWidths.push(baseCellWidth - shrinkWidthPerCol);
    } else {
      colWidths.push(baseCellWidth);
    }
  }

  // Calculate row heights
  const rowHeights: number[] = [];
  for (let r = 0; r < rows; r++) {
    if (r === focusedRow) {
      rowHeights.push(baseCellHeight + expansionHeight);
    } else if (focusedIndex >= 0) {
      rowHeights.push(baseCellHeight - shrinkHeightPerRow);
    } else {
      rowHeights.push(baseCellHeight);
    }
  }

  // Calculate column X positions
  const colXPositions: number[] = [gap];
  for (let c = 1; c < cols; c++) {
    colXPositions.push(colXPositions[c - 1] + colWidths[c - 1] + gap);
  }

  // Calculate row Y positions
  const rowYPositions: number[] = [gap];
  for (let r = 1; r < rows; r++) {
    rowYPositions.push(rowYPositions[r - 1] + rowHeights[r - 1] + gap);
  }

  const layouts: TileLayout[] = [];

  tilableWindows.forEach((window, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);

    // Handle last row potentially having fewer items
    const isLastRow = row === rows - 1;
    const itemsInLastRow = tilableWindows.length - (rows - 1) * cols;

    let width = colWidths[col];
    let finalX = colXPositions[col];

    // If last row and fewer items, need special handling
    if (isLastRow && itemsInLastRow < cols) {
      // Recalculate for last row - stretch to fill, but still apply focus expansion
      const lastRowTotalWidth = containerSize.width - (itemsInLastRow + 1) * gap;
      const lastRowBaseWidth = lastRowTotalWidth / itemsInLastRow;

      // Check if focused window is in last row
      const focusedInLastRow = focusedRow === row;
      const focusedLastRowCol = focusedInLastRow ? focusedCol : -1;

      if (focusedInLastRow && itemsInLastRow > 1) {
        const lastRowExpansion = lastRowBaseWidth * FOCUS_EXPANSION_RATIO;
        const lastRowShrink = lastRowExpansion / (itemsInLastRow - 1);

        if (col === focusedLastRowCol) {
          width = lastRowBaseWidth + lastRowExpansion;
        } else {
          width = lastRowBaseWidth - lastRowShrink;
        }

        // Recalculate X position for last row
        finalX = gap;
        for (let c = 0; c < col; c++) {
          if (c === focusedLastRowCol) {
            finalX += lastRowBaseWidth + lastRowExpansion + gap;
          } else {
            finalX += lastRowBaseWidth - lastRowShrink + gap;
          }
        }
      } else {
        width = lastRowBaseWidth;
        finalX = gap + col * (lastRowBaseWidth + gap);
      }
    }

    layouts.push({
      windowId: window.id,
      position: { x: Math.round(finalX), y: Math.round(rowYPositions[row]) },
      size: { width: Math.round(width), height: Math.round(rowHeights[row]) },
    });
  });

  return layouts;
}
