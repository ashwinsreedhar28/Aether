## [2026-06-09] ADR: visualizer node despawned on desktop — code, manifest entry, and reserved shell edge held for the AVP track (issue #220)

**Status:** accepted
**Decided by:** Architect (issue #220 spec, 2026-06-09), answering the follow-up
ruling forecast by the same-day `raven → visualizer.render` ADR below; applied
by Implementer.
**Context:** The visualizer Mixer reads mesh state (`mesh_introspection.topology`,
`lanes.status`, `intents.list`, calendar surfaces) and POSTs composed scene
panels to the RAVEN_AVP scene server. The 2026-06-09 Viewer × Aether merge ADR
(§5; #203) archived the scene server — Viewer's workspace store is the layout
authority on desktop — so the node's panel-POST half is dead on this surface,
and the same-day Lane 3 ADR left the node's disposition as "a follow-up ruling
for the visualizer's own lane." This is that ruling.
**Decision:** The shell stops auto-spawning the visualizer on desktop (the
`spawnVisualizer` call and method leave `nodeManager.ts`). The node code
(`nodes/visualizer`), its manifest entry, and the reserved
`shell → visualizer.render` edge all stay for the AVP track. Revival there is
re-adding a spawn call from git history, not rebuilding the node.
**Consequences:** Desktop boots without a visualizer child — no spawn line, no
panel-POSTs — and the Mesh app shows the node absent/stopped, which is honest:
it genuinely isn't running. Core still resolves `env:MESH_VISUALIZER_SECRET`
at manifest load (the manifest entry stays), so the secret remains in Core's
env with no child to receive it. The visualizer package keeps building and
typechecking in CI (`pnpm -r`), so the AVP track inherits working code rather
than bit-rot.
**Alternatives considered:** (a) Delete the node outright (the Lane 3 shape for
the Dashboard voice tools) — rejected: the AVP track needs it; unlike those
tools it has a named future consumer. (b) Retarget the node to compose Viewer
apps — rejected: Viewer's workspace store is the layout authority, and a mesh
node composing desktop layout would recreate the bridge on a surface that no
longer wants one.
