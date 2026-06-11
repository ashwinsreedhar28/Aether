## [2026-05-14] Rename project homeOS → Aether (working name retired)

**Status:** accepted
**Decided by:** Director (Architect-recommended)
**Context:** The project was bootstrapped under the working name
"homeOS" — a descriptive placeholder while we figured out what the
thing actually was. Through v0.3.x the working name carried; by the
data-realization milestone it was clear the project had earned its
own identity. "homeOS" reads as a category (one of many "home OS"
projects) rather than a name; "Aether" — the classical luminiferous
medium connecting everything — better captures the substrate framing
(the spine the rest of the modules ride on) and is one syllable shorter
to say aloud, which matters for a voice-first product.

**Decision:** Adopt **Aether** as the project name. Specifically:
- All in-prose references in current-state docs (README, CLAUDE.md,
  MASTER_SYNTHESIS.md, manifest, sub-READMEs) become "Aether."
- npm package scope `@homeos/*` → `@aether/*`. Root packages
  `homeos-shell` → `aether-shell`, `@homeos/raven-daemon` →
  `@aether/raven-daemon`.
- Env var `HOMEOS_DATA_DIR` → `AETHER_DATA_DIR` (passed by the shell
  to data nodes; every node refuses to start without it).
- Electron `productName` "homeOS" → "Aether"; bundle identifier
  `com.homeos.app` → `com.aether.app`.
- Renderer bridge `window.homeOS` → `window.aether`; preload type
  `HomeOSApi` → `AetherApi`.
- App icon: introduce the cosmic-navy aurora-curtain icon (Concept C
  per the icon design review) — SVG + generated PNGs + .icns bundle
  committed under `shell/assets/`.
- One-time macOS data-dir migration at first boot of the renamed app:
  rename `~/Library/Application Support/homeOS/` →
  `~/Library/Application Support/Aether/` before any node spawns so
  existing news / finance / memory state carries forward.

**Consequences:**
- DECISIONS.md ADRs from earlier dates are left verbatim — they refer
  to "homeOS" as the project name at the time. Same for CHANGELOG
  entries from earlier versions. Top-of-file framing is updated to
  flag the rename.
- Bundle-id change means macOS treats the renamed app as a *new* app:
  Director's existing window state, Keychain entries, and microphone
  / notification permissions will reset. Accepted as a clean break —
  the alternative (keep the old appId) is misleading and risks future
  conflicts when Director eventually wants to deploy both halves
  (substrate + workspace).
- GitHub repository remains at `ashwinsreedhar28/homeOS` — separate
  decision, separate timeline. GitHub's auto-redirect keeps existing
  clone URLs alive when Director eventually renames the repo.
- Director's local working directory remains on the working name; the
  Director will rename it (or not) on their own schedule. Nothing in
  the code path depends on the local directory name.
- The `_ingest/*` submodules (Pulse, RAVEN_MESH, NEXUS, VIEWER) are
  out of scope — external repos with their own naming.

**Alternatives considered:**
- *Keep "homeOS" forever.* Rejected: reads as a category name, not a
  product name; future-Director will hit this same fork later with
  more cruft accumulated.
- *Rename to "Substrate" / "Mesh" / "Hearth".* Considered briefly.
  Substrate / Mesh describe pieces of the architecture, not the whole;
  Hearth was warmer but more domesticated than the always-on
  ambient-computing arc the roadmap commits to.

---


## Older decisions

Decisions dated 2026-05-13 and earlier are archived in
[docs/archive/decisions-pre-2026-05-14.md](docs/archive/decisions-pre-2026-05-14.md).


## 2026-05-25 — ADR: Substrate stays human-architected

**Status:** Accepted

**Context.** Sprint 5 closed with the mesh becoming observable end-to-end (PRs #109–#113). The roadmap doc (#114) names Aether-Architect as the eventual mesh node that converses with Director to draft and (later, gated) fire new mesh extensions. Sprint 10 ships the draft-only version; Sprint 11 extends to fire-and-watch for sensors; Sprint 14 to mixers; Sprint 17 to content apps; Sprint 19 (gated) to self-improvement of its own prompts.

Across all of those stages, one constraint is load-bearing: **the substrate itself is never delegated.**

**Decision.** The Aether-Architect node, at any maturity level (Sprint 10 through Sprint 19+), is NEVER authorized to touch:

1. `core/core/` — the mesh broker. All routing, dispatch, invocation recording, and introspection logic stays human-architected.
2. `manifest.yaml` edge-graph topology — the *structure* of allowed-edges between nodes. The Architect can propose new nodes (which gain new edges by adding to the graph); it cannot rewrite the graph between existing nodes.
3. The confirmation pattern (Sprint 7 work) — `safe | confirm | destructive` surface declarations, broker enforcement of confirmation envelopes, voice rendering of confirmation. The mechanism by which dangerous actions get principal consent stays human-architected forever.

These are the load-bearing primitives. If any of them break, the whole mesh's safety model breaks. Self-extension applies to leaves (sensors, actors, mixers, content apps) — never to the root.

**Consequences.**
- Sprint 19's gated self-improvement loop applies only to Aether-Architect's own *prompts*, not to the substrate code those prompts produce. The Architect cannot improve itself by rewriting the broker.
- If a future lane proposes loosening this rule, the discipline is to slow down, not speed up. The ADR is the wall against the seemingly-reasonable case ("it's just one small change"), not the obviously-wrong case.
- Future Architects evaluating "should we let the Architect touch X" should default to no unless X is unambiguously a leaf (Sensor/Actor/Mixer/content app) and X has zero downstream consumers in `core/core/`.

**Related.** Roadmap doc (`docs/agent-platform-roadmap.md`) Architectural Anchors section, Failure Modes section. PR #114 introduced this concept; this ADR formalizes it.

## 2026-05-25 — ADR: Manifest `description` field convention

**Status:** Accepted

**Context.** Sprint 5 substrate categorized every mesh node by `Sensor`/`Actor`/`Mixer`/`Planner`. Categorization made the mesh legible to mesh-viz. But mesh-viz hovers only show node id, category, surface count, and status — there's no human-language explanation of *what each node does*. The same gap blocks Sprint 13 voice introspection ("Hey Aether, what can you do?") and Sprint 10 Aether-Architect (which needs to read the existing surface inventory before drafting new ones).

**Decision.** Every `manifest.yaml` node entry gains an optional `description: string` field describing what the node does in user-facing language (one or two sentences, prose, no markdown).

Three downstream consumers (consumer list updated 2026-05-26 per Sprint 5.5 direction shift; original list named mesh-viz hover as first consumer, which is obsolete now that the content-app paradigm is being archived):
1. **Visualizer node** (Sprint 6.4): the visualizer reads `mesh_introspection.topology` and composes scene panels that include node descriptions. First consumer to land.
2. **Raven voice introspection** (Sprint 14): when asked "what can you do," raven reads `mesh_introspection.topology` and reads the descriptions aloud, grouped by category.
3. **Aether-Architect** (Sprint 11): consumes descriptions as context when conversing with Director about new mesh extensions.

**Amendment 2026-05-26:** The original ADR proposed Sprint 6 backfill of 17 nodes. Director's Pulse-read recon in Sprint 5.5 found all 16 user nodes already have `metadata.description` populated (universal coverage was already in place, just not threaded through the broker payload). PR #118 shipped the substrate threading (schema + broker + types); no backfill needed. The convention is now formalized and live; Sprint 7's new sensors comply when they land.

**Consequences.**
- `core/schemas/manifest.json` gains an optional `description` field with a max-length constraint (proposed: 280 characters; matches a tweet, prevents overflow in tooltips/voice).
- Description content is the node author's responsibility; reviewed during PR for accuracy and tone.
- Empty/missing descriptions are graceful: tooltips fall back to category + surface count; voice falls back to "I have a node called X" rather than describing it.

**Related.** Sprint 6 lane spec (roadmap doc), Sprint 13 voice depth (roadmap doc), #104 issue comment listing 108d as deferred lane.


## 2026-05-26 — ADR: Direction shift to dashboard + scene-driven architecture

**Status:** Accepted

**Context.** Sprint 5 closed with the mesh observable end-to-end and the content-app paradigm validated through the mesh-viz, news, finance, and voice-control apps. The roadmap doc (#114) framed Sprints 6-20 around expanding sensor breadth, then layering Planner runtime, then Aether-Architect self-extension — all rendered through additional content apps in the Electron shell.

Sprint 5.5 surfaced a different direction. Director discussed Aether with the creator of the RAVEN repos (which Pulse and the original RAVEN substrate were based on). The conversation identified two structural problems with the content-app trajectory:

1. **Janky frontend doesn't mesh together.** Each content app is its own React component with its own visual language. Adding sensors means adding apps; the shell becomes a launcher of dissimilar interfaces. The cost of "yet another app" grows with each addition.

2. **Not Jarvis-like.** The desired interaction model is voice/CLI input → summoned visualization → dismissal. Windowed content apps are persistent stateful UI; Jarvis-style is transient generated content. The shell should be a HUD with a dashboard backdrop and summoned overlays, not a Finder for content apps.

The collaborator shared `R-A-V-E-N-delegate/RAVEN_AVP` — a separate repo he'd built that solves the visualization composition problem for Apple Vision Pro. It runs a FastAPI server holding authoritative SceneDoc state (panels + entities + transforms), broadcasts deltas via WebSocket, and lets generator scripts compose visualizations of arbitrary systems (Pulse, Google Search, future Aether). The AVP client subscribes and mounts panels in immersive space.

**Decision.** Aether's presentation layer pivots from "windowed content apps" to "scene-driven dashboard + summoned overlays."

Concretely:
- The four current content apps (news, finance, voice-control, mesh-viz) are archived in Sprint 6.1 (`_archive/shell-content-apps/`). The `AppDefinition` / app-registry / nav-launcher pattern is removed.
- RAVEN_AVP is vendored at `daemons/raven-avp-server/` (git submodule) and runs as an Aether daemon (Sprint 6.2). It binds localhost:5180 for the shell on this machine; cross-machine Tailscale access is enabled for the AVP shell joining at Sprint 17.
- The macOS shell is rewritten as a scene subscriber (Sprint 6.3). It connects to the scene server's `/scene/stream` WebSocket, maintains an in-memory `RemoteSceneStore` (mirroring RAVEN_AVP's Swift client pattern), and renders panels + entities as 2D HTML/SVG instead of the AVP shell's 3D RealityKit.
- A new visualizer mesh node (Sprint 6.4) consumes mesh state and composes scene panels. One surface: `visualizer.render(intent, args?)`. Intent-routed internally to template functions.
- Voice and CLI input both route through `visualizer.render` (Sprint 6.5). Saying "show me the mesh" or typing it in the CLI triggers the same intent path.

**Three subsystems, fully decoupled:**
1. **Aether mesh** — data layer (sensors + broker + manifest). Knows nothing about presentation.
2. **RAVEN_AVP scene server** — presentation state holder. Knows nothing about Aether's mesh semantics.
3. **Shells** (macOS + AVP) — scene subscribers. Each renders the same SceneDoc differently.

The visualizer mesh node is the *only* component aware of both the mesh and the scene server. It is the bridge.

**Consequences.**

- Most content-app code (~1500-2000 lines across `shell/src/apps/`) moves to `_archive/`. Nothing deleted; archive preserves all of it for future reference or pattern-lifting.
- Bundle size drops significantly on Sprint 6.1 (similar to PR #115's deletion-lane bundle delta).
- The shell becomes substantially smaller — voice pill + CLI + scene subscriber, instead of voice pill + 4 content apps + launcher.
- Sprint numbers shift by one for Sprints 7-15 (e.g. what was Sprint 6 sensor breadth becomes Sprint 7). Sprint 17 newly added for AVP shell active dev; Sprints 18-20 cover Architect expansion + 1.0 stabilize work.
- The Sprint 5 retrospective doc gets an addendum naming the Sprint 5.5 pivot.
- This ADR makes "the shell" plural — there are now two shells (macOS Electron and AVP Swift), and Aether is built to support both without changes to the mesh.

**Why this is reversible-ish.** The mesh substrate is untouched by this shift. If the scene-driven approach proves wrong, we'd un-archive the content apps and re-wire the launcher; the mesh keeps working throughout. The visualizer node would lose its scene-server consumer and just be dead code for one sprint until a new presentation strategy lands.

**Why this is the right shift now.** Director's tested with two patterns (Pulse's windowed dashboard + Aether's content apps) and is not satisfied with either. The collaborator's RAVEN_AVP is production-ready presentation infrastructure that the AVP shell will need anyway. Adopting it as Aether's presentation layer for both shells means: one canonical presentation API, two rendering targets (2D and 3D), trivial cross-shell consistency. The cost of the shift now is one sprint of archive + reshape work; the cost of NOT shifting compounds as more content apps would be needed for each new sensor.

**Related.**
- Roadmap doc rewrite (this PR) covers the full Sprint 6-20 reshuffle.
- Manifest-description-convention ADR (above) amended to point at visualizer as the first consumer instead of mesh-viz hover.
- The HTTP-everywhere ADR (below) formalizes the inter-subsystem protocol commitment.
- The Aether-is-data-layer ADR (below) formalizes the architectural boundary.
- The substrate-stays-human-architected ADR (existing) continues to apply unchanged — none of this lets the Architect node touch substrate.

## 2026-05-26 — ADR: HTTP-everywhere for inter-subsystem communication

**Status:** Accepted

**Context.** With the Sprint 5.5 direction shift, Aether becomes a three-subsystem architecture (mesh + scene server + shells). These subsystems could communicate via many patterns: in-process function calls, shared memory, file-system state, message queues, REST, WebSocket, gRPC, custom protocols. Each pattern has tradeoffs in latency, decoupling, debugging surface area, deployability, language-portability, and replaceability.

**Decision.** Inter-subsystem communication uses HTTP/WebSocket exclusively. Specifically:

- **Mesh → scene server:** HTTP POST to `/scene/panel/{id}` and `/scene/entity/{id}`, HTTP PATCH to `/scene` for batch ops. (The visualizer mesh node initiates; the scene server accepts.)
- **Shell → scene server:** WebSocket subscription to `/scene/stream` for snapshots + deltas; HTTP GET `/scene` for full-state refetch on reconnect.
- **Shell → mesh:** existing patterns continue (shell talks to mesh broker over HTTP, broker dispatches signed envelopes). No change from Sprint 5.
- **Voice (raven) → mesh:** existing patterns continue (raven calls mesh tools through its function-calling layer; mesh edges enforced by broker).
- **Voice (raven) → scene server:** raven does NOT talk to scene server directly. Voice triggers mesh routes that hit `visualizer.render`; visualizer is the only mesh node that talks to the scene server.

**No exceptions for performance.** If a future use case feels like it needs in-process speed (e.g. "the visualizer shouldn't HTTP-POST 100 panels at 60fps"), the answer is: don't POST 100 panels at 60fps. The visualizer composes the SceneDoc state in batched mutations; the scene server's deltas-over-WebSocket handle real-time UI updates. Animation lives in the rendering layer (entity animations declared in panel/entity dicts), not in flooding HTTP.

**Consequences.**

- Every inter-subsystem interaction is debuggable from a terminal with `curl`. This is genuinely huge for development and troubleshooting.
- Subsystems are replaceable. The visualizer mesh node could be rewritten in Python, Rust, or Go with no change to the scene server. The scene server could be replaced with a Node.js implementation without touching the mesh.
- Subsystems are independently deployable. The scene server's lifecycle is decoupled from the shell's; crash and restart independently. If the scene server crashes, the shell shows a connection-lost state but doesn't itself crash.
- Cross-machine extension is trivial. Today the scene server runs localhost; tomorrow the AVP shell connects to it over Tailscale. No protocol change.
- Testing: every subsystem can be tested by mocking the HTTP endpoints of its neighbors. The mesh tests don't need a scene server; the scene server tests don't need a mesh.
- Latency cost is real (HTTP roundtrip vs in-process call). For Aether's use cases, this is acceptable — the slowest path (voice → mesh → visualizer → scene server → shell render) is bounded by voice latency (~500ms-1s), which dwarfs HTTP overhead (~5-20ms localhost).

**Constraints inherited from RAVEN_AVP.**
- Panel `style` field values MUST be strings (AVP's Swift client decodes as `[String: String]?`; non-string values silently fail SceneMessage decode). The visualizer node must coerce numeric style values to strings before POST. Banked in CLAUDE.md §10 and the visualizer node's README.
- RAVEN_AVP v1.0 has no auth on the scene server (Tailscale ACL is the trust boundary). Aether's localhost-only use is acceptable; cross-machine needs minimal auth before Sprint 17.

**Related.**
- Aether-is-data-layer ADR (below) — describes the boundary HTTP-everywhere enforces.
- Direction-shift ADR (above) — names this commitment as one of the architectural anchors.

## 2026-05-26 — ADR: Aether is the data layer; scene server is the presentation layer

**Status:** Accepted

**Context.** The Sprint 5.5 direction shift and the HTTP-everywhere commitment together imply a strict architectural boundary: mesh on one side, scene server on the other, visualizer node as the only bridge. This ADR formalizes that boundary as a permanent contract, so future lanes don't accidentally erode it.

**Decision.** Aether's mesh holds *data*. The RAVEN_AVP scene server holds *presentation state*. The boundary is enforced both in code (no mesh component except the visualizer node knows scene server URLs or panel/entity schemas) and in convention (mesh schemas never include presentation hints like colors, positions, or rendering modes).

**What's in the mesh:**
- Sensor data (calendar events, focus state, location, etc.)
- Actor capabilities (send email, create event)
- Mixer composition (briefings, voice composition)
- Planner output (proposals, daily briefings as structured data)
- Broker state (topology, recent activity, node health)
- Manifest declarations (categories, descriptions, edge graph)

**What's in the scene server:**
- Panels (text, html, image, markdown, model3d, chart, mermaid, group)
- Entities (geometry + material + transform + gestures + animations)
- Positions in world space (meters, AVP coordinate frame)
- Visual styles (fonts, colors, opacity, sizes)
- Scene structure (which panels are present, in what arrangement)

**What's in the visualizer mesh node** (the bridge):
- Intent → composition mappings (`mesh` intent reads `mesh_introspection.topology`, composes radial panel layout)
- Knowledge of the scene server's HTTP API
- Knowledge of both the mesh schemas it consumes and the scene schemas it emits
- Template functions per intent (mesh-radial, activity-stream, briefing, etc.)

**Boundary tests.** A change is creeping the boundary if:
- A mesh sensor's surface schema gains a "preferred display color" field (presentation hint in mesh; wrong)
- The scene server gains direct read access to a mesh surface (presentation layer reaching into data; wrong)
- A second mesh node (besides visualizer) starts POSTing to the scene server (the bridge becomes multi-node; wrong)
- The visualizer node grows logic that's *purely* presentation (e.g., "pick a different layout if the user's display is dark mode") with no reference to mesh data (the visualizer is supposed to be a *bridge*, not a renderer; this kind of logic belongs in the shell)

**Consequences.**

- Adding a new sensor is a mesh-only change. Adding a new visualization for that sensor is a visualizer-node-only change. The two are independently authorable.
- A new shell (web, future devices) is a scene-subscriber-only change. No mesh work needed for a new shell as long as the visualizer supports the intents the new shell wants to display.
- Sprint 17's AVP shell adoption is "easy" — the mesh is unchanged, the visualizer is unchanged, only the new shell's subscription code is new.
- Failure mode #5 (presentation-layer creep into mesh) is identified by this ADR and added to the roadmap doc.

**What this ADR does NOT forbid.**
- Mesh surfaces can include semantic categorization that the visualizer happens to use for layout decisions (e.g., `category: Sensor` is mesh-side and is used by visualizer to color radial branches). The principle: it's allowed if it's semantically meaningful in the mesh AND the visualizer happens to consume it; forbidden if it's purely a rendering hint.
- The shell can have local-only UI state that's not in the scene (e.g., CLI history, scroll position). Local-only state lives in shell React state and is fine.

**Related.**
- Direction-shift ADR — establishes the three-subsystem split this ADR formalizes.
- HTTP-everywhere ADR — protocol commitment that makes the boundary enforceable.
- Substrate-stays-human-architected ADR — orthogonal but compatible (the Architect node cannot touch broker; this ADR adds that the broker also cannot grow presentation logic).
