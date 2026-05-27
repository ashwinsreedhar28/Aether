# Aether Agent Platform Roadmap

**Status:** canonical sprint anchor. Updated at major direction shifts; otherwise referenced as the single source of truth for what Aether is becoming.

**Last major rewrite:** 2026-05-26 — direction shift to dashboard + scene-driven architecture (Sprint 5.5 pivot). Pre-shift version (banked in PR #114) covered the windowed-content-app model; this version reflects the dashboard + visualizer + AVP-collaboration architecture.

---

## What Aether is

A personal-OS substrate: a signed mesh of nodes that observe, compose, and act on a principal's behalf, with voice and text as first-class input surfaces. Pre-1.0, macOS-first, with Vision Pro (AVP) as a parallel-developed second shell joining at Sprint 17.

**The thing that's different post-Sprint-5.5:** the principal does NOT navigate Aether by switching between windowed content apps (news, finance, calendar, etc.). The principal interacts via voice or text, and Aether *summons* visualizations of relevant state on demand. Persistent UI is a diagnostic dashboard — what's alive, what's pending, what just happened. Transient summoned visualizations overlay or replace the dashboard when invoked.

This is more Jarvis than Finder. Less windowed-OS, more conversational HUD.

---

## Architecture (after Sprint 5.5 direction shift)

Three subsystems, fully decoupled, communicating over HTTP/WS:
┌─────────────────────────────────────────────────────────────┐
│                     AETHER MESH                             │
│  (signed broker + sensor/actor/mixer/planner nodes)         │
│                                                             │
│  manifest.yaml — edge graph, secrets, categories            │
│  core/core — broker, dispatch, /introspection           │
│  nodes/* — sensors (calendar, focus, sports, ...) etc.      │
│  daemons/raven-core — voice (Gemini Live)                   │
│  nodes/visualizer — NEW (Sprint 6.4) composes scene         │
│                     mutations from mesh state               │
└────────────────────────┬────────────────────────────────────┘
│
│  HTTP POST /scene/panel/{id}
│  HTTP PATCH /scene
│
▼
┌─────────────────────────────────────────────────────────────┐
│            RAVEN_AVP SCENE SERVER (vendored)                │
│        daemons/raven-avp-server/ — Python/FastAPI           │
│                                                             │
│  Authoritative SceneDoc (panels + entities + transforms)    │
│  REST: GET/PUT/PATCH /scene, /scene/panel/{id}              │
│  WS: /scene/stream — snapshot on connect, deltas on mutate  │
│  Persistence: scene_state.json (atomic write)               │
│  Transport: localhost on this machine; Tailscale for AVP    │
└────────────────────────┬────────────────────────────────────┘
│
┌──────────┴──────────┐
│                     │
▼                     ▼
┌─────────────────────┐   ┌─────────────────────────┐
│  AETHER MACOS SHELL │   │   AETHER AVP SHELL      │
│  (Electron, this)   │   │   (Swift, collaborator) │
│                     │   │                         │
│  • Diagnostic       │   │  • ImmersiveSpace       │
│    dashboard        │   │  • 3D panel mounts      │
│    (scene-derived)  │   │  • Hand gestures        │
│  • CLI input        │   │  • Voice via local STT  │
│  • Voice pill       │   │                         │
│  • Transient        │   │  Subscribes to same     │
│    overlays         │   │  SceneDoc via WS.       │
│                     │   │  Joins Sprint 17.       │
└─────────────────────┘   └─────────────────────────┘

**Three architectural commitments locked at Sprint 5.5:**

1. **Aether mesh is the data layer.** Sensors collect, mixers compose, the broker dispatches signed envelopes. The mesh knows nothing about presentation.

2. **RAVEN_AVP scene server is the presentation layer.** Holds authoritative SceneDoc state, broadcasts deltas. Knows nothing about Aether's mesh semantics — just panels, entities, transforms.

3. **Clients (shells) are scene subscribers.** Both the macOS Electron shell and the AVP Swift shell subscribe to the same SceneDoc. They render it differently (2D vs 3D), but the authoritative state is shared. New shells (web, future devices) can join the same way.

The visualizer mesh node is the *only* component that knows about both layers: it consumes mesh state and composes scene mutations. Every other piece sees one side or the other, never both.

---

## The six-piece arc (unchanged through Sprint 5.5)

The long-term shape Aether grows toward, expressed as six progressive capabilities. Sprints map onto these pieces; the pieces themselves don't change with the direction shift.

1. **Observability** — the mesh sees itself. Substrate-side legibility. (Shipped Sprint 5.)
2. **Sensor breadth** — enough world-state for a planner to compose meaningfully. (Sprint 7.)
3. **Confirmation pattern** — dangerous actions ask before firing. (Sprint 8.)
4. **Planner runtime** — Aether composes responses unasked. (Sprints 9-10.)
5. **Self-extension** — Aether-Architect drafts and fires new mesh extensions, with safety rails. (Sprints 11-12, 15, 19-20.)
6. **Multi-shell + memory** — same mesh, multiple presentation surfaces; personal preference accumulation. (Sprints 13, 17.)

The Sprint 5.5 direction shift changes *how piece 4 manifests* (planner output is visualized, not laid out as content apps) and *adds piece 6's multi-shell dimension* (AVP joining at Sprint 17 means the mesh outlives any single presentation).

---

## Architectural anchors

Load-bearing constraints. Future Architect chats can recompute most things from first principles, but these anchors don't get re-derived — they're settled.

### 1. The four-category vocabulary
Every mesh node is exactly one of: **Sensor** (read-only, exposes world state), **Actor** (changes world state), **Mixer** (composes other surfaces), **Planner** (decides what to invoke next). This is the vocabulary mesh-viz used in Sprint 5 and the vocabulary the visualizer node uses in Sprint 6+. It survived Sprint 5 contact with reality (17 nodes categorized cleanly). It's right.

### 2. Substrate stays human-architected
The Aether-Architect node (Sprint 11+) NEVER touches `core/core/` (broker), `manifest.yaml` edge-graph topology, or the confirmation pattern. Self-extension applies to *leaves* (sensors, actors, mixers, visualizer templates) — never the root. Formal ADR in DECISIONS.md.

### 3. Voice is structurally universal
Raven has edges to every other surface. This is load-bearing for "Hey Aether, what can you do?" at Sprint 14 — voice introspection reads `mesh_introspection.topology` and the manifest descriptions, not a dedicated capabilities surface.

### 4. Manifest descriptions are convention
Every node has `metadata.description` (formalized in #118, all 16 user nodes already comply, core got its first description). Consumed by visualizer node (Sprint 6.4), raven voice introspection (Sprint 14), Aether-Architect (Sprint 11). ADR in DECISIONS.md.

### 5. Aether is the data layer; scene server is the presentation layer (NEW post-5.5)
Three subsystems, all HTTP/WS-coupled, all detachable. The visualizer mesh node is the only crossing point. New ADR in DECISIONS.md.

### 6. HTTP-everywhere protocol commitment (NEW post-5.5)
Inter-subsystem communication uses HTTP/WS exclusively. No in-process function calls between mesh, scene server, and shells; no shared memory; no shared filesystem state beyond the scene server's own `scene_state.json`. This makes every piece independently testable, deployable, and replaceable. New ADR in DECISIONS.md.

### 7. The 4-phase sprint shape is the unit
Sprint = roadmap (Phase 1) → cleanup (Phase 2) → features (Phase 3) → retro (Phase 4). Sprint variance in lane count is a feature, not a bug. Future Architects evaluate "are we on track?" by phase completion, not lane count or calendar time.

### 8. Substrate-vs-renderer split (validated Sprint 5.5)
The schema + broker + daemon types side of any change outlives the renderer side. PR #118 validated this when its mesh-viz hover code was discarded while the substrate landed clean. Future lanes that touch both layers should be drafted with this split in mind: substrate ships standalone-useful; renderer is the consumer that may change.

---

## Sprint plan

Sprints 5 closed and retro'd. Sprint 5.5 was the direction-shift conversation + this rewrite. Sprint 6 starts with the direction shift's foundation work; Sprints 7+ shift downstream by one number.

### Sprint 6 — Direction Shift Foundation

**Theme:** Archive the content-app paradigm. Stand up the diagnostic dashboard shell and CLI input. Vendor the RAVEN_AVP scene server. Ship the visualizer mesh node v1. Wire voice through to scene mutations.

**Phased; lanes ordered by dependency. Lower-number lanes unblock higher-number ones.**

#### Sprint 6.1 — Content-app archive + placeholder dashboard

Move all current content apps to `_archive/shell-content-apps/`. Remove the `AppDefinition` / app-registry pattern. Strip `App.tsx`'s launcher (nav bar, ICON_MAP, app-switching state). Replace with a placeholder dashboard React component — static markup, no scene subscription yet, no CLI yet. Just enough to verify the shell still launches and doesn't crash.

What archives: `shell/src/apps/news/`, `shell/src/apps/finance/`, `shell/src/apps/voice-control/`, `shell/src/apps/mesh-viz/` (the latter completing 108d's fate). `app-registry.ts`, the ICON_MAP entries for archived apps, the launcher's nav bar component.

What stays: voice pill, daemon-manager wiring, theme (`shell/src/theme/holographic.css`), Electron main process, splash screen.

Net diff: -1500 to -2000 lines. Bundle-size delta reported in PR body (likely 30-40% reduction). Verify-build green.

The archived directory carries a `_archive/README.md` explaining what's there and why (direction shift to scene-driven model), so future archaeology is clean.

#### Sprint 6.2 — Vendor RAVEN_AVP scene server

Add `R-A-V-E-N-delegate/RAVEN_AVP` as a git submodule at `daemons/raven-avp-server/` (mirroring the `_ingest/Pulse` and `_ingest/RAVEN` submodule pattern, but at `daemons/` since this is a runtime dependency, not a reference pattern source). Add a `daemons/raven-avp-server/start.sh` shim if needed.

Wire it into shell boot via a new daemon-manager in `shell/electron/main/` — same shape as `ravenDaemonManager`, `visionDaemonManager`, etc. Pattern: shell starts, daemon manager spawns scene server (Python venv bootstrap on first run), shell waits for `GET /scene` to respond before considering boot complete.

Add admin auth eventually (not v1.0 — RAVEN_AVP v1.0 has no auth, network ACL is the trust boundary on Tailscale). For Aether's localhost-only use, no auth is acceptable initially. Bank as a Sprint 16 hardening item.

Port collision check: scene server binds 5180; verify no Aether component already uses it. (Today's Aether uses 8000 for broker, 7433 for raven-daemon, 5173 for Vite dev server. 5180 is clear.)

#### Sprint 6.3 — CLI prompt + scene subscriber in shell

Replace the placeholder dashboard with the real one. Two sub-features in one lane:

**CLI prompt UI** — Claude-Code-style text input at the bottom of the shell window, scrolling output area above. Output area shows: voice transcripts, command results, scene-mutation acknowledgments, agent activity stream, raven status. Up-arrow command history. Multi-line on Shift+Enter. State managed via React + Zustand (or Context, lighter touch). No terminal emulation — this is an intent-input surface, not a shell.

**Scene subscriber** — shell connects to `ws://127.0.0.1:5180/scene/stream`. Reconciles snapshots + deltas. Maintains an in-memory `RemoteSceneStore` (mirroring RAVEN_AVP's Swift client pattern). Renders panels + entities as 2D HTML/SVG instead of 3D RealityKit.

The diagnostic dashboard backdrop is composed of panels that the visualizer node *seeds* on shell boot — mesh-health, raven status, active sensors, recent activity stream. These are always-present scene panels with stable IDs (e.g. `dashboard.mesh-health`, `dashboard.raven-status`). The visualizer node sees broker startup events (via `mesh_introspection.topology`) and POSTs these dashboard panels to the scene server. The shell renders them as the backdrop.

Transient overlays are panels with non-dashboard IDs, summoned by voice/CLI commands, that the visualizer node POSTs in response. They render over the backdrop.

#### Sprint 6.4 — Visualizer mesh node v1

`nodes/visualizer/` — new TS mesh node. Exposes ONE surface:

```typescript
surface: 'visualizer.render'
input: { intent: string, args?: object }
returns: { ok: true } | { ok: false, error: string }
```

Internal architecture: an intent → renderer-function registry. Each registered function:
1. Reads any necessary mesh data via mesh edges (e.g. `mesh_introspection.topology` for the `mesh` intent, `calendar.weekly` for a calendar intent)
2. Composes a list of panel/entity dicts following RAVEN_AVP's SceneDoc schema
3. POSTs them to `http://127.0.0.1:5180/scene/panel/{id}` for each panel (or `/scene/entity/{id}` for entities — verify exact endpoint when wiring)

**v1 intents (Sprint 6.4 scope):**

1. **`mesh`** — radial mesh topology visualization. Lifts code from archived mesh-viz's `RadialLayout.tsx`, ports the geometry math, emits one panel per node + a group of entities for the radial connections. The dashboard pattern (always-visible) vs overlay (summoned) is determined by the panel `id` namespace.

2. **`activity_stream`** — recent invocation feed (newest-first list). Reads `mesh_introspection.activity`. Composes a text panel per entry, arranged vertically.

3. **`sensor_health`** — sensors-at-a-glance dashboard panel. Reads `mesh_introspection.topology`, filters to Sensor category, renders a status panel.

These three are the smallest viable set that proves the visualizer pattern. New intents added in later sprints incrementally (Sprint 7 adds sensor-specific visualizations as each new sensor lands).

**Constraint from RAVEN_AVP source-reading:** every `panel.style` value must be a string. The Swift client decodes `style` as `[String: String]?`; non-string values silently kill SceneMessage decode. Documented in visualizer node's README + CLAUDE.md §10 gotchas. Worth banking before any panel-composing code is written.

**Manifest entry for visualizer:**

```yaml
- id: visualizer
  runtime: local-process-ts
  category: Mixer
  identity_secret: env:MESH_VISUALIZER_SECRET
  metadata:
    description: |
      Composes mesh state into scene mutations and POSTs them to the
      local RAVEN_AVP scene server. Single render surface; intent-routed
      internally to template functions. The only mesh component that
      knows about both the mesh and the scene server.
  surfaces:
    - name: render
      type: tool
      invocation_mode: request_response
      schema: schemas/render.schema.json
```

New edges from `manifest.yaml`:
- `raven → visualizer.render` (voice triggers visualizations)
- `shell → visualizer.render` (CLI triggers visualizations)
- `visualizer → mesh_introspection.topology` (visualizer reads mesh state)
- `visualizer → mesh_introspection.activity` (visualizer reads activity)
- (Future) `visualizer → calendar.weekly`, `visualizer → finance.quotes`, etc. — added as each new intent's data source

#### Sprint 6.5 — Voice integration for visualizer

Raven gains a new tool registered in `prompts.json`'s `function_descriptions`:

```python
visualize(intent: str, args: dict | None = None) -> str
```

Voice instructions extended: "If the user asks to see something, call `visualize(intent='mesh')` (or appropriate intent). Speak a brief acknowledgment ('Showing you the mesh') while the visualization renders."

Voice calls `raven → visualizer.render` mesh edge. Visualizer composes panels + POSTs to scene. Shell's WebSocket connection receives the delta, renders new panels.

End-to-end smoke at Sprint 6.5 close: Director says "Hey Aether, show me the mesh" → voice transcript appears in CLI output area → mesh-radial visualization renders as a panel in the shell's dashboard → Director says "thanks" → voice dismisses the visualization (POST removes the panels).

#### Sprint 6 also includes (Phase 2 cleanup work)

- **ECONNRESET investigation** — deferred from Sprint 5.5. Profile CC's long-write behavior, check status.claude.com historical data for the affected windows, decide on mitigation. Bank findings in governance-log.
- **Manifest description backfill review** — all 16 user nodes have descriptions per recon; do a tone-consistency pass during Sprint 6.4's visualizer work since the descriptions will start being visible.
- Sprint 6 retro (Phase 4)

#### Lane count discipline (Sprint 6)

5 substantial lanes + 2 cleanup items + retro = 8 things. Phase 1 will lock the order and parallelization plan. Likely sequencing:

- 6.1 + 6.2 in parallel (different code surfaces — archive is `shell/src/apps/`, scene server is `daemons/`)
- 6.3 after 6.1 + 6.2 land (depends on both)
- 6.4 after 6.2 lands (depends on scene server availability)
- 6.5 after 6.4 lands (depends on visualizer node)

This serializes nicely: archive + vendor → CLI/dashboard → visualizer → voice. 4-5 actual "wait points" for Director review/merge.

### Sprint 7 — Sensor breadth (was Sprint 6 pre-shift)

**Theme:** Thicken the mesh with read-only sensors. Each gets a visualizer intent + RAVEN voice tool.

**Lanes (selected from a wider candidate set per width-over-depth discipline):**

- **Calendar enhancement** — already a node; expand surfaces (e.g. `calendar.density` for visualizer's weekly view)
- **Location passive sensor** — home/work/transit, no GPS streaming
- **Focus state sensor** — foreground app, idle, Do Not Disturb
- **Sports node** — Pulse-matching surfaces (NBA focus per Pulse). RAVEN voice tool ("how did the Lakers do?") follows in same lane.
- **Research node** — needs Pulse read for scope decision (academic arxiv-style vs broader "interesting reading" curation)

Each new sensor lands with:
- `manifest.yaml` entry with `metadata.description`
- New visualizer intent registered (visualizer reads the sensor's surface, composes panels)
- New voice tool if relevant

**Deferrable to Sprint 7.5 or 8:** clipboard history enhancement (existing node; not load-bearing for Planner runtime).

### Sprint 8 — Confirmation pattern + first dangerous actor

**Theme:** Dangerous actions ask before firing. Surface declarations gain a `safety: safe | confirm | destructive` field; broker enforces confirmation envelopes for non-safe surfaces.

**Lanes:**
- Schema + broker work for confirmation envelopes
- Voice rendering of confirmation prompts (raven speaks "About to send this email — confirm?")
- Confirmation visualization (visualizer intent: `confirmation_prompt` — renders the action as a styled overlay panel with accept/reject)
- First dangerous actor: `macos_mail.send` or `calendar.create_event` — pick whichever lands cleanest

Sprint 7's sensors don't need confirmation (read-only). Sprint 8 is the first time the mesh writes to the world on its own.

### Sprint 9 — Planner runtime (first composing-unasked behavior)

**Theme:** Aether composes daily briefing without being asked. Planner node fires at boot + on focus-state changes, reads sensor surfaces, composes a briefing.

**Lanes:**
- `nodes/planner/` — a Mixer node
- Briefing rendered as a visualizer panel (intent: `briefing`)
- Voice reads it aloud if user is around
- Test mesh edges added from planner to relevant sensors

### Sprint 10 — Daemon-planner + proposal overlays

**Theme:** Planner runs continuously, surfaces suggestions as proposal overlays via visualizer. User accepts/rejects via voice or CLI.

**Lanes:**
- Daemon-mode planner
- Proposal visualization (intent: `proposal`)
- Accept/reject wiring back to mesh

### Sprint 11 — Aether-Architect (draft-only)

**Theme:** A node that converses with Director to draft new mesh extensions. Cannot fire CC yet. Output: a written spec + visualizer rendering of what the new node would look like in the topology.

**Lanes:**
- `nodes/architect/` — a Mixer node
- Read access to `mesh_introspection.topology` + manifest descriptions
- Visualizer intent: `architect_draft` — renders the proposed node + edges as a preview panel
- Conversation surface (voice and CLI)

### Sprint 12 — Aether-Architect fire-and-watch + agent queue visualization

**Theme:** Architect fires CC sessions for new sensor nodes (whitelisted to sensors only). Visualizes the agent queue. **Critical addition from Sprint 5.5 direction-shift conversation:** the deployment agent state — what's queued, what's running, what's completed — gets its own visualizer intent so Director can see what the Architect is doing.

**Lanes:**
- Architect → CC subprocess wiring
- Agent queue surface (a Mixer surface on the Architect node)
- Visualizer intent: `agent_queue` — renders queue state
- Whitelist enforcement (sensor nodes only this sprint)
- New mesh edges audited per the substrate-stays-human-architected ADR (Architect can add new nodes, cannot rewrite graph between existing nodes)

### Sprint 13 — Memory / personal preferences

**Theme:** Aether accumulates personal preference state (what user rejected, what stuck, voice patterns, content preferences). Memory is a sensor surface.

**Lanes:**
- `nodes/memory/` — a Sensor node
- Surfaces: `memory.preferences`, `memory.history`
- Visualizer intent: `preferences` — renders what Aether knows about the user

### Sprint 14 — Voice depth pass 1

**Theme:** Wake word, multi-turn turn-taking, latency, voice introspection ("what can you do?"). The first sprint where voice feels less like a command shell and more like a conversation partner.

**Lanes:**
- Wake word integration
- Multi-turn state machine
- Latency profiling + reduction
- Voice introspection lane — raven reads `mesh_introspection.topology` + manifest descriptions on "what can you do?" trigger; visualizer renders the capability surface inventory as an overlay while voice speaks the summary

### Sprint 15 — Architect Mixer expansion

**Theme:** Architect whitelist grows to include Mixers (not just Sensors). The Architect can now propose mesh-level composition logic, not just data sources.

**Lanes:**
- Whitelist expansion
- New audit gates (Mixer code touches more surfaces; more review)
- Test of the substrate-human-architected boundary — Architect proposing a new Mixer that would touch broker is the exact case the ADR forbids; verify the guard holds

### Sprint 16 — 1.0 stabilize

**Theme:** Reduce risk before AVP collaborator joins. Bug fixes, performance, crash resilience, deployment hardening.

**Lanes:**
- Bug bash sweep
- Performance profiling (mesh broker latency, scene server WebSocket throughput, shell render cost)
- Crash resilience (scene server crash → does shell reconnect gracefully? mesh broker crash → does shell recover?)
- Deployment hardening (Tailscale + RAVEN_AVP scene server: add minimal auth for cross-machine use)
- Documentation pass (READMEs, CLAUDE.md, DECISIONS.md, this roadmap doc)

### Sprint 17 — AVP shell joins

**Theme:** Vision Pro shell starts active development by collaborator. Both shells subscribe to the same SceneDoc; coordinate via mesh contracts.

**Lanes:**
- AVP shell skeleton — Xcode project, connects to scene server WebSocket over Tailscale
- Cross-machine scene server access — when does Aether's scene server run on Director's machine vs collaborator's machine vs both?
- Cross-shell coordination patterns — both shells smoke-test against every mesh contract change going forward (new failure mode: inter-shell substrate drift)
- AVP-specific extensions to SceneDoc — entities with rotate animations, hand gestures, 3D placements that don't apply to 2D shell

This is the sprint where the "Aether is the data layer" commitment pays off — the AVP shell can stand up without ANY changes to mesh or scene server, just by being another scene subscriber.

### Sprint 18 — Architect content/visualization expansion

**Theme:** Architect can now draft visualizer intents and new sensors that synthesize multiple data sources. Whitelist expanded further; audit gates tightened in parallel.

**Lanes:**
- Visualizer intent registration via Architect-generated code
- Multi-source sensor proposals
- Audit gate hardening

### Sprint 19 — Cross-surface macros

**Theme:** Voice + CLI commands can trigger multi-step flows ("get me caught up" → planner briefing + email summary + calendar preview, all composed and rendered together).

**Lanes:**
- Macro registry
- Macro composition surface on planner
- Visualizer intent: `macro_result` — multi-panel composition

### Sprint 20 — Architect self-improvement (gated)

**Theme:** Architect can amend its own prompts based on accumulated outcomes. Gated by Director review of every prompt change. Substrate-stays-human-architected ADR holds: only Architect's *prompts* are self-modifiable, never substrate code.

**Lanes:**
- Architect prompt versioning
- Self-amendment surface (proposes prompt change, Director accepts/rejects)
- Outcome tracking — what proposals succeeded, what got rejected

---

## Candidate themes beyond Sprint 20

Not banked as sprint lanes; held as "themes worth pursuing if Aether's 1.0+ trajectory needs them."

- **Peripherals federation.** Aether on macOS coordinates with Aether on iOS via shared mesh state. Phone becomes a sensor (location, focus, notifications).
- **Multi-user shared spaces.** Two principals each running Aether, with selective cross-mesh edges. Privacy boundaries enforced at the mesh layer.
- **Network of personal substrates.** Federation of Aethers across friends/family; capabilities like "share this calendar event with my partner's Aether."
- **Speech-to-anything pipeline.** Voice → arbitrary action via visualizer-mediated confirmation.
- **Long-context memory with structured recall.** Memory as a queryable corpus, not just preference accumulation.

These are not roadmap; they're a sketch of what 2.0+ could mean.

---

## Personalization arc

A short narrative of how Aether becomes personal-to-Director over the next 12 sprints, restated for the post-shift architecture:

- **Sprints 6-7:** Aether observes (sensors expand, observability deepens). Director's life-state flows through the mesh as data.
- **Sprints 8-9:** Aether composes briefings unasked. The visualizer renders these as overlays Director can react to.
- **Sprints 10-11:** Aether proposes via Daemon-planner; the Architect appears. Director starts negotiating new sensors into existence by conversation.
- **Sprints 12-13:** Aether starts firing CC for new sensors itself. Memory of what Director said yes/no to begins accumulating.
- **Sprint 14:** Voice depth means the principal conversation feels real. "Hey Aether" + something specific = real action.
- **Sprints 15-17:** Aether becomes a multi-shell HUD. Same authoritative state across macOS dashboard and AVP immersive space.
- **Sprints 18-20:** Aether self-extends within bounded autonomy. Substrate stays human-architected; everything else is fair game.

By Sprint 20, Aether is conversational, multi-shell, partially self-extending, and accumulates a real model of Director. Pre-1.0 ships somewhere between Sprint 16 (stabilize) and Sprint 17 (AVP joins).

---

## Failure modes

Five failure modes that are load-bearing to avoid. Sprint 5 banked three (substrate erosion, rung-skipping, velocity confusion); Sprint 5.5 adds two new ones.

### 1. Substrate erosion (banked Sprint 5)
The broker / manifest edge-graph / confirmation pattern gets touched by an automated agent (CC session run unsupervised, or eventually Aether-Architect). Mitigated by the substrate-stays-human-architected ADR; recurring vigilance required.

### 2. Rung-skipping (banked Sprint 5)
A lane fires from a sprint several ahead of the current sprint because it "feels easy." Mitigated by Phase 1 lane spec discipline + roadmap doc as the canonical "what's next" reference.

### 3. Velocity confusion (banked Sprint 5)
Sprint completion measured by lane count or calendar time rather than phase completion. Mitigated by the 4-phase sprint shape and roadmap-as-canonical-anchor.

### 4. Inter-shell substrate drift (NEW post-Sprint-5.5)
The macOS and AVP shells consume the same mesh contracts (via the scene server). A contract change made for one shell breaks the other. Mitigated by:
- Every mesh contract change requires smoke verification against BOTH shells before merge
- Both shell maintainers (Director for macOS, collaborator for AVP) sign off
- The scene server's strict schema enforcement (Pydantic) catches contract violations early
- Failure surfaces in scene server logs (panel-decode failures, etc.) — bank as known indicator

This failure mode doesn't apply until Sprint 17 when AVP starts active dev. But the contract discipline starts NOW so that Sprint 17 doesn't need a retroactive cleanup of "everything we should have been doing."

### 5. Presentation-layer creep into mesh (NEW post-Sprint-5.5)
The temptation to "just add this rendering hint to a mesh surface" because it would make the visualizer's job easier. Mitigated by the Aether-is-data-layer ADR + the HTTP-everywhere protocol commitment. The visualizer composes; mesh emits raw state. If the visualizer needs a hint, it goes in the visualizer node's intent-routing logic, not the mesh schema.

Test for whether something is creeping: does the proposed change make sense if there were FOUR shells consuming the mesh, with different rendering priorities each? If yes, it belongs in the mesh. If only one shell benefits, it belongs in the visualizer (or the shell itself).

---

## Process meta

How the roadmap doc is used:

- **Sprint Phase 1** opens by reading this doc + the most recent retro
- **Each lane spec** references the roadmap's sprint section to confirm scope
- **PR bodies** cite the roadmap when a lane introduces something architecturally load-bearing (e.g. "this is the first instance of <pattern named in the roadmap's architectural anchors>")
- **Sprint retros** mention this doc only when something in here needs to change (new ADR, new failure mode, etc.)
- **Direction shifts** rewrite this doc entirely (as Sprint 5.5 did)

CLAUDE.md and DECISIONS.md are the operational layer below this roadmap. Roadmap owns *direction*; CLAUDE.md owns *how we work*; DECISIONS.md owns *what we committed to architecturally*. Governance-log owns *what we learned along the way*.

Future Architect chats inherit this doc as their starting anchor. The cost of writing it well (this Sprint 5.5 rewrite is ~700 lines) is amortized across every future chat that reads it instead of reconstructing from PR bodies.

---

## Sprint 5.5 — what just happened

Between Sprint 5 retro (#116) and the Sprint 6 Phase 1 start, two micro-lanes shipped (#117 voice swap, #118 manifest description throughput). After #118, Director discussed Aether with the creator of the RAVEN repos. The conversation surfaced a direction shift: rather than building windowed content apps, lean into Jarvis-style on-demand visualizations via the RAVEN_AVP scene server. This roadmap doc was rewritten at that point to reflect the new direction.

PR #118 itself shipped under the new direction — its scope was reduced mid-flight from "manifest description threaded to mesh-viz hover" to "manifest description threaded to broker payload" (mesh-viz being archived in Sprint 6.1). That's documented in #118's PR body as the first mid-flight scope reduction precedent.

Sprint 6 Phase 1 starts after this roadmap rewrite lands.
