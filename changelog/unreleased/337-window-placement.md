### Added
- Semantic window placement, end-to-end (#337). A fixed v1 **region
  grammar** — halves, quadrants, thirds, two-thirds, `center` (60%
  centered), `full` — resolved by ONE pure function
  (`shell/src/utils/regionResolver.ts`, unit-tested across the grammar and
  odd display sizes: complementary regions abut exactly, nothing drifts a
  pixel off-display). A new atomic `setWindowBounds` store action applies
  position + size in a single update (no move-then-resize double paint).
  Surfaces: the `place-window` controlBridge action (region OR explicit
  bounds — exactly one; unknown region → named refusal listing the
  grammar), the signed `viewer_desktop.place_window` mesh surface
  (schema-validated region enum), and a `place_window` **voice tool** —
  "put the browser in the left half" places the window and the confirmation
  names the region. Explicit pixel bounds stay the programmatic escape
  hatch, never the default.
