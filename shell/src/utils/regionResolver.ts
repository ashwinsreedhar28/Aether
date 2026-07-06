/**
 * Region Resolver — the semantic window-placement grammar (#337).
 *
 * Pure function from (region, displayBounds) → pixel bounds. This is the ONE
 * place the v1 grammar is defined and resolved: voice ("put the browser in
 * the left half"), the mesh (viewer_desktop.place_window), and the renderer
 * (controlBridge 'place-window') all land here. Explicit pixel bounds remain
 * the escape hatch on those surfaces, never the default — see
 * decisions/2026-07-06-semantic-region-grammar.md.
 *
 * The region enum in nodes/viewer_desktop/schemas/place_window.json and the
 * REGIONS tuple in daemons/raven-core/raven_core/tools/viewer_tool.py mirror
 * REGIONS below — grep all three when the grammar grows (§11.9).
 */

export interface DisplayBounds {
  width: number;
  height: number;
}

export interface ResolvedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Semantic order (§11.1): halves → quadrants → thirds → two-thirds → center → full.
export const REGIONS = [
  'left',
  'right',
  'top',
  'bottom',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'left-third',
  'center-third',
  'right-third',
  'left-two-thirds',
  'right-two-thirds',
  'center',
  'full',
] as const;

export type Region = (typeof REGIONS)[number];

export function isRegion(value: string): value is Region {
  return (REGIONS as readonly string[]).includes(value);
}

// Each region as fractional edges of the display: [x0..x1] × [y0..y1].
// 'center' is the 60%-centered floater from the spec (0.2..0.8 both axes).
const FRACTIONS: Record<Region, { x0: number; x1: number; y0: number; y1: number }> = {
  left: { x0: 0, x1: 1 / 2, y0: 0, y1: 1 },
  right: { x0: 1 / 2, x1: 1, y0: 0, y1: 1 },
  top: { x0: 0, x1: 1, y0: 0, y1: 1 / 2 },
  bottom: { x0: 0, x1: 1, y0: 1 / 2, y1: 1 },
  'top-left': { x0: 0, x1: 1 / 2, y0: 0, y1: 1 / 2 },
  'top-right': { x0: 1 / 2, x1: 1, y0: 0, y1: 1 / 2 },
  'bottom-left': { x0: 0, x1: 1 / 2, y0: 1 / 2, y1: 1 },
  'bottom-right': { x0: 1 / 2, x1: 1, y0: 1 / 2, y1: 1 },
  'left-third': { x0: 0, x1: 1 / 3, y0: 0, y1: 1 },
  'center-third': { x0: 1 / 3, x1: 2 / 3, y0: 0, y1: 1 },
  'right-third': { x0: 2 / 3, x1: 1, y0: 0, y1: 1 },
  'left-two-thirds': { x0: 0, x1: 2 / 3, y0: 0, y1: 1 },
  'right-two-thirds': { x0: 1 / 3, x1: 1, y0: 0, y1: 1 },
  center: { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.8 },
  full: { x0: 0, x1: 1, y0: 0, y1: 1 },
};

/**
 * Resolve a named region to integer pixel bounds inside the display.
 *
 * Edges are rounded INDEPENDENTLY and sizes derived by subtraction
 * (width = round(W·x1) − round(W·x0)), so complementary regions abut with
 * no gap or overlap on odd display dimensions, and the far edge lands on
 * round(W·1) = W exactly — nothing ever drifts a pixel off-display.
 */
export function resolveRegion(region: Region, display: DisplayBounds): ResolvedBounds {
  const f = FRACTIONS[region];
  const x = Math.round(display.width * f.x0);
  const y = Math.round(display.height * f.y0);
  return {
    x,
    y,
    width: Math.round(display.width * f.x1) - x,
    height: Math.round(display.height * f.y1) - y,
  };
}
