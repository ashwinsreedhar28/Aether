## [2026-06-09] ADR: `raven → visualizer.render` edge removed with the Dashboard-era voice tools (Lane 3, folds #210)

**Status:** accepted
**Decided by:** Director (Lane 3 spec, folding PR #210's proposal and answering its open question) under the jointly-ratified 2026-06-09 Viewer × Aether merge ADR (§5 scene server archived, §6 Raven-only assistant); applied by Implementer.
**Context:** The Sprint 6.5 `visualize` voice tool summoned Dashboard panels by
invoking `visualizer.render` over the mesh — the `raven → visualizer.render`
edge in manifest.yaml authorised that hop — and its sibling `navigate` flipped
the Dashboard's instrument views (no mesh hop). The 2026-06-09 merge ADR
retired the Dashboard/scene-server surface in favour of Viewer's workspace
store (§5), leaving both tools and the edge as dead surface. PR #210 (Colton)
proposed disabling the tools via `_DISABLED_MODULES` and removing the edge,
asking whether the source files should be deleted outright; the Lane 3 spec
folded #210 in and answered: remove.
**Decision:** Delete `visualize_tool.py` and `navigate_tool.py` from
`daemons/raven-core/raven_core/tools/` (full removal, not a
`_DISABLED_MODULES` entry — git history preserves the source) and remove the
`raven → visualizer.render` edge from manifest.yaml, leaving a retirement
comment at the edge's former position. The `shell → visualizer.render` edge,
the visualizer node definition, and its read edges
(`mesh_introspection.topology`, `lanes.status`, `intents.list`,
`calendar.today`, `calendar.upcoming`) are unchanged.
**Consequences:** raven no longer exposes `visualize`/`navigate`, and the mesh
contract reflects the Viewer-only surface. The visualizer node now has no
caller of its render surface except the shell edge (effectively a reserved
edge); whether the node re-targets Viewer apps or retires is a follow-up
ruling for the visualizer's own lane, not decided here. Reviving voice-driven
visualization means restoring the tool from git history and re-adding the edge
through a new ADR.
**Alternatives considered:** (a) Disable via `_DISABLED_MODULES`, keeping the
modules on disk (#210's original shape) — rejected by the lane spec: the
Dashboard the tools drove is gone, and dead surface should not ship in the
tree when git history preserves it. (b) Keep the `raven` edge dormant for a
future Viewer-rendered visualize tool — rejected: an unconsumed edge misstates
the wire contract, and re-adding one is a small ADR'd change when that tool
exists.
