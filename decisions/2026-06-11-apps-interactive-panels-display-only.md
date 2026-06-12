## [2026-06-11] ADR: apps are interactive MeshApps; panels stay display-only (#334)

**Status:** accepted

**Decided by:** Director (Architect spec on #334, amending the #225 ruling),
implemented on `lane/issue-334`.

**Context:** The standing #225 ruling — "display-only, voice is the remote" —
was written while the Music app shipped without playback controls, and Lane B
built it that way. Its real subject was narrower than its wording: the
interaction risk it guarded against lives in PANELS (Raven-rendered
visualizer surfaces), where a control path from rendered output back through
the mesh has no designed protocol — no per-surface identity to sign with, no
edge to authorize against. Shell APPS never had that problem: they are
MeshApps — React in the renderer — and the renderer's `mesh.invoke` already
routes as the `shell` node over manifest-governed `shell → <node>.<surface>`
edges, the same signed-envelope path the devtools smoke tests exercise. The
`shell → music.*` edges have existed since #332 for exactly this.

**Decision:** Shell apps MAY be interactive: an app may invoke Actor surfaces
through `window.aether.mesh.invoke` over its own `shell → <node>.<surface>`
manifest edges. Panels (Raven-rendered visualizer surfaces) remain
display-only until a panel-interaction protocol is designed and recorded in
its own ADR. First application: #334's Music app playback controls
(prev / play-pause / next over `shell → music.{skip,pause,play}`).

**Consequences:**
- The Music app gains controls; the #225-era "no buttons, voice is the
  remote" framing is superseded for apps (the empty-state line stays — voice
  still works from anywhere, it is just no longer the *only* remote).
- An interactive app is a mesh consumer like any other: every
  consumer/surface pair needs its own manifest edge (#136's lesson) — app
  lanes must land their edges with the feature.
- Prose written under the old ruling (#225 changelog fragment, older
  comments) reads "display-only" — historical entries stay verbatim per
  the append-only law; this ADR is the supersession record.
- A panel that needs interaction is a protocol-design lane, not an ad-hoc
  exception; this ADR is the line future specs cite either way.

**Alternatives considered:**
- Keep apps display-only too (rejected: forfeits an already-designed,
  already-authorized signed-envelope path for no safety gain — the manifest
  edge graph is the authorization model, and it already speaks for apps).
- Make panels interactive the same way (rejected: panels are composed
  daemon-side and rendered, not React mesh clients — there is no identity
  or edge for a panel to invoke with; interactivity there needs real
  protocol design).
- A per-app allowlist of interactive apps (rejected: the app/panel split is
  the load-bearing boundary; a second list would drift and the manifest
  edges already gate per-surface capability).
