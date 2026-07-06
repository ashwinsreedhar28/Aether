## [2026-07-06] ADR: The semantic region grammar is the canonical placement path (#337)

**Status:** accepted

**Decided by:** Architect (ratified spec on #337), implementation on `lane/issue-337`.

**Context:** The renderer already shipped every per-window geometry primitive
(`moveWindow`, `resizeWindow`, `updateWindow`, `calculateSnap`), but no agent
surface could *place* a window — "put the browser in the left half" had no
tool, no mesh surface, and no single answer to "what does 'left half' mean in
pixels." Each consumer (voice, mesh, a future UI affordance) could have grown
its own region→bounds arithmetic, which is exactly the divergence class that
made three copies of the layout-preset list a standing §11.9 grep target.
Placement also composed badly from the existing primitives: a move-then-resize
pair renders as a double paint and is not atomic across the store.

**Decision:** A fixed v1 region grammar — `left | right | top | bottom`
(halves), `top-left | top-right | bottom-left | bottom-right` (quadrants),
`left-third | center-third | right-third`, `left-two-thirds |
right-two-thirds`, `center` (60% centered), `full` — is the canonical
placement path, and `shell/src/utils/regionResolver.ts` is its single
resolver. Voice (`place_window` tool), the mesh
(`viewer_desktop.place_window`), and any renderer surface all resolve regions
through it; the mesh schema and the voice tool's `REGIONS` tuple are
declared mirrors of its `REGIONS` export (grep all three together, §11.9).
Resolution rounds region *edges* independently and derives sizes by
subtraction, so complementary regions abut exactly and nothing drifts a pixel
off-display on odd dimensions. Placement applies through a new atomic
`setWindowBounds` store action — position + size in ONE update. Explicit
pixel bounds remain the escape hatch on the bridge and mesh surfaces
(`bounds` instead of `region`, exactly one of the two), never the default,
and the voice tool does not expose them at all.

**Consequences:**
- "Left half" means the same pixels no matter who asks — voice, mesh agent,
  or a future snap UI — and growing the grammar is a one-file change plus its
  two declared mirrors.
- An unknown region is a *named* refusal carrying the full grammar, so a
  calling agent recovers in-turn instead of reporting the viewer broken
  (open_app's error-payload precedent).
- `setWindowBounds` unhides/unmaximizes the placed window (a placement the
  user can't see didn't happen), consistent with `applyLayoutPreset`'s
  `isMaximized: false` precedent.
- v1 regions are display-relative fractions of the workspace container; a
  future multi-display substrate re-parameterizes `DisplayBounds` without
  touching the grammar.

**Alternatives considered:**
- *Free-form fractional bounds only (no named grammar).* Rejected: pushes
  region arithmetic into every model prompt and agent, guaranteeing drift
  ("left half" resolving differently by caller) and making refusals
  unnameable — there is no enum to list back.
- *Resolve regions node-side (main process) instead of renderer-side.*
  Rejected: the renderer owns the container geometry (workspace-tabs inset,
  `window.innerWidth`), so main-process resolution would need a geometry
  round-trip anyway; keeping the resolver beside the store keeps one source
  of truth for "the display."
- *Compose placement from existing `moveWindow` + `resizeWindow`.* Rejected:
  two store updates, two renders, and a visible half-applied intermediate
  state; the spec's atomicity requirement (AC2) exists precisely because this
  composition was tried mentally and reads as flicker.
- *Aero-snap-style zone extensions in the same lane.* Deferred out of scope
  by the spec; the grammar is deliberately v1-exhaustive and closed.
