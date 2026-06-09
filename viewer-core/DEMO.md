# Unified Viewer Ecosystem — Demo Walkthrough

**For the ~11 AM walkthrough on 2026-06-06.** Built overnight. This doc = the topology you need in your head + the demos I want to walk you through + exactly what needs a restart or a rebuild before each one (so nothing surprises us live).

---

## 1. The one-sentence thesis

Two apps — **viewer-desktop** (macOS/Electron) and **viewer-spatial** (visionOS/RealityKit) — now share ONE content layer (`@viewer/core`) and ONE mesh control layer (the viewer nodes). Same View → React window on desktop, html panel in the headset. Two authoring paths (generators emit Views, tools place Views), one cross-device session for handoff. The shells stay distinct on purpose; the content + control converge.

---

## 2. Topology — what runs where (know this before we start)

### Mac mini (`100.109.10.50`) — the backend box
- **Scene server `:5180`** (`viewer-spatial/server`) — authoritative SceneDoc for the headset, serves the shared renderer bundle at `/static/viewer/`, and now exposes `/views/*` + `/generators/{slug}/run`.
  - ✅ **Restarted ~00:05 with tonight's code** (main.py PID 68257). Verified live: `GET /views` → 200, `GET /scene` → 200, `POST /generators/wiki_graph_2d/run` → 200 (1 panel), `POST /scenes/run knowledge_graph` → 200 (229 entities). The old stale process (PID 39087, started 19:46) is gone.
  - 🐛 **Fixed during restart:** the RAVEN_AVP→viewer-spatial rename had left a dead `generator_path` in 8 scene `metadata.json` files (`/scenes/run` was 500ing). Repointed all 8 to `viewer-spatial/` and verified each target exists. Committed `~/raven` 91350d5.
- **LATTICE Core `:8000`** — the HMAC-signed envelope router (your live mesh: edith/raven/voice/avp/browser/avp_voice).
- **viewer_spatial + viewer_session nodes** — Python; launch when we go live.

### Your Mac (`coltons-mac`) — dev + interaction box
- **viewer-desktop (Electron)** — the macOS shell. The `viewer_desktop` mesh node runs *inside* Electron-main.
- **You build + deploy the Vision Pro app from here (Xcode).** 🚩 **I cannot rebuild/redeploy the headset binary.** Any demo step needing a fresh AVP app is called out below with 🚩 — that's your action.

### Vision Pro — the spatial shell
- Deployed RealityKit client. Pulls SceneDoc + WS deltas from `:5180`, renders panels (incl. `html` panels hosting the shared renderers) + 3D entities.

---

## 3. Pre-demo checklist (I run these before you wake; this is the state I'm driving to)

1. ✅ Graph-unify worker committed (`397207d`) → scene server `:5180` restarted → `GET /views` → 200 (was 404). Done ~00:05.
2. ✅ `POST :5180/generators/wiki_graph_2d/run` → 200, opens 1 View panel (80 nodes / 149 edges). Slug is **`wiki_graph_2d`**. The 3D twin is `POST :5180/scenes/run {"slug":"knowledge_graph"}` → 229 entities. SAME `extract_wiki_graph()` dataset.
3. ✅ Manifest fragment ready at `RAVEN_LATTICE/manifest.viewer-nodes.yaml` + go-live runbook (validated against a local throwaway Core on :8099, NOT the live mesh).
4. ✅ Desktop app: `npm run build` clean — a running-app reload picks up the new renderers; **no native rebuild needed.**
5. 🚩 **AVP binary**: confirm the deployed headset app already renders `html` panels pointing at `:5180/static/viewer/`. If it does, all the html-panel demos are live with zero rebuild. If the html-panel host path isn't in the deployed binary yet → **you rebuild before we demo D-A/D-B.** (I'll have verified server-side; the client-render half is the unknown only you can confirm.)

---

## 4. The demos

### D-A — "One View, two shells" (the foundational proof)
**Claim:** the exact same View object renders in both shells.
- Open a markdown (or json) View on desktop → a React window.
- Open the SAME View on spatial via `open_view` → an html panel hosting the same renderer.
- **Walk-through:** identical content, different shell. One contract, zero duplicated renderer code (we deleted ~2300 lines of desktop-specific rendering this is built on).
- Needs: scene server restarted (✓ checklist #1), 🚩 AVP binary renders html panels (checklist #5).

### D-B — "One dataset, two renderings" (the HEADLINE)
**Claim:** the SAME wiki knowledge-graph data renders as 3D spheres+lines on the headset AND a 2D React graph on the desktop — provably one dataset, not two hand-built graphs.
- This is the elegant version of tonight's biggest decision. You already had a mature 3D `knowledge_graph` scene (walks `~/raven/context`, parses `[[links]]`, 3D force layout). I almost rebuilt it for the 2D side — instead I factored out `extract_wiki_graph()` so BOTH paths consume one extraction.
- **Walk-through (both verified on the running server ~00:05):**
  - Headset: `POST :5180/scenes/run {"slug":"knowledge_graph"}` → 229 entities (80 spheres, one per wiki page + 149 lines, one per `[[link]]`). ✓ 200
  - Desktop/2D: `POST :5180/generators/wiki_graph_2d/run` → 1 `knowledge-graph` View (80 nodes / 149 edges, node-id set IDENTICAL to the 3D sphere ids) → renders as the React graph renderer. ✓ 200
  - Point: both come from the SAME `extract_wiki_graph()` call. Change the wiki, both change. One source of truth — provably, since the node-id sets match.
- Needs: ✅ all server-side verified. The 3D side already worked on your headset before tonight; the 2D-from-same-data side is the new half. 🚩 the headset render of the 2D html-panel depends on the deployed AVP binary hosting `/static/viewer/` (checklist #5).

### D-C — "Handoff" (cross-device session)
**Claim:** a workspace built on one device rehydrates on the other.
- Build 2-3 views on desktop → `session_handoff(target=viewer_spatial)` → the whole set opens on the headset (and focus is preserved).
- The `viewer_session` mesh node holds `{views, focused}` and drives the target node's `open_view`/`focus_view`.
- **Honest caveat:** session is in-memory — a node restart loses it. Fine for the demo; noted as a future durability item (a 30-line JSON doc on the mesh, if we ever want persistence — deliberately NOT built yet to avoid over-engineering).
- Needs: both viewer nodes live on a Core (we can show this against the local test Core, or the live mesh after the morning splice).

### D-D — "The agent's interface" (your emphasized ask)
**Claim:** the docs ARE the product for an agent.
- Walk `viewer-core/docs/AGENTS.md` (the mental model: View object, tools path, generators path, when to use which, the desktop-vs-spatial gotchas) + `docs/system-prompt.md` (the dense fragment you'd inject into an orchestrator).
- This is the "context around the interfaces you give it" you specifically called out. The whole ecosystem is driveable from these two files.

---

### D-E — "The generator library" (View-type coverage, both shells)

**Claim:** an agent can build any common UI artifact in one `params -> View[]` call, and it
renders in BOTH shells with zero per-shell code. Tonight I parallelized **11 generators**
spanning every View type — proof the contract is general, not a one-off for the graph.

One registry, one call to populate it: `registerAllGenerators()` (TS) /
`register_all_generators()` (Python) register the identical 11 slugs in both languages.
Run any on spatial via `POST :5180/generators/{slug}/run`; on desktop via
`runGenerator(slug, params)` → loop `open_view` (the §6 asymmetry).

| slug | View type | what it emits |
| --- | --- | --- |
| `knowledge-graph` | knowledge-graph | node+edge mindmap (the D-B proof case) |
| `sprint_board` | kanban | a populated software-sprint board |
| `data_table` | table | sortable table from CSV (real training log) |
| `flow_diagram` | mermaid | the viewer-ecosystem flow diagram |
| `status_report` | markdown | a full Daily Ops briefing |
| `math_sheet` | latex | a math-formula reference sheet |
| `metric_tiles` | html | a self-contained KPI-tile dashboard |
| `timeline` | html | a vertical timeline from chronological events |
| `image_gallery` | html | a responsive grid of inline-SVG tiles |
| `json_inspector` | json | a collapsible JSON tree (mesh introspect payload) |
| `workspace` | multi (md+html+table+mermaid+kanban) | a whole arranged multi-panel cockpit in one call |

- **Coverage:** every one of the 10 ViewTypes is exercised by at least one generator; the
  `workspace` generator emits a 5-panel artifact from a single call (the "build me a whole
  dashboard" case).
- **Parity:** each generator is mirrored TS↔Python and the suites assert byte-identical
  output — `data_table` etc. read a SHARED fixture through both `build`s. Green tonight:
  viewer-core **118 TS + 71 Python**, desktop **check + 15**.
- **Naming:** all slugs are `lower_snake` except the historical `knowledge-graph` (kept for
  back-compat with the deployed scene). I normalized `sprint-board → sprint_board` tonight;
  its View display-id stays `sprint-board` so the existing render path is untouched.

---

## 4b. Interactivity demos — the human's hands flow back (`view_event`)

**The new surface tonight.** Until now the whole ecosystem was a one-way medium:
agent paints a View, human looks at it, gestures (drag/edit/check) had nowhere to
go and were dropped. `view_event` closes the loop — the human's gesture is
delivered back to the agent that opened the view as a mesh invocation, and the
agent reacts. These three demos show the FULL round-trip.

**How the loop works (same for all three):** at `open_view` time the shell records
who opened the view (`openedBy` = your `env.from`). On each interaction it emits a
`fire_and_forget` invocation to *your* `view_event` inbox with the frozen payload
`{ viewId, type, action, data, ts }`. You react with a fresh outbound call
(`notify`, a re-`open_view`, a persist). No new viewer-node surface — it rides the
existing mesh on `env.from`.

> **Shell status — be honest live.** **Desktop is the end-to-end-true shell**: the
> gestures below emit real `view_event`s today. **Spatial** has the server-side
> emit path wired but visionOS gesture plumbing may be partial — demo these on
> **desktop**, and for spatial say "same loop, spatial-side status: see
> `viewer-spatial`." Don't claim a spatial gesture round-trips unless you've
> confirmed it there.

### D-F — Kanban card drag → agent marks it done (the headline interactivity demo)
**Claim:** the human moves work on the board and the agent *knows*, instantly.
- **View:** open the sprint board — `run_generator { slug: 'sprint_board' }` (or
  `open_view` a `kanban` View directly). A populated board appears in the desktop
  window.
- **Gesture:** drag the card **"Wire view_event"** from *In Progress* → *Done*.
- **Event the agent receives** (on its `view_event` inbox):
  ```jsonc
  { "viewId": "sprint-board", "type": "kanban", "action": "card_moved",
    "data": { "cardId": "t-42", "fromColumn": "In Progress", "toColumn": "Done", "position": 0 },
    "ts": "2026-06-06T11:04:22.118Z" }
  ```
- **Agent reaction (visible):** the handler sees `toColumn === 'Done'` and fires
  `notify { level:'info', text:'Marked "Wire view_event" done — nice.' }` → a
  desktop toast pops. The human dragged; the agent responded. Loop closed.
- Needs: desktop app running (✅ checklist #4). Spatial: same loop, spatial-side
  status: see `viewer-spatial`.

### D-G — Knowledge-graph node drag → agent receives `node_moved`
**Claim:** the same wiki-graph from D-B is now *touchable*, not just viewable.
- **View:** the 2D knowledge-graph View (`run_generator { slug: 'wiki_graph_2d' }`,
  or the `knowledge-graph` demo graph) in the desktop window.
- **Gesture:** drag a node to reposition it.
- **Event the agent receives:**
  ```jsonc
  { "viewId": "wiki-graph", "type": "knowledge-graph", "action": "node_moved",
    "data": { "nodeId": "raven/context/soul", "x": 312, "y": 188 },
    "ts": "2026-06-06T11:06:10.402Z" }
  ```
- **Agent reaction (visible):** the agent logs/persists the new layout (or
  `notify`s the moved node id) — the human's arrangement is now data the agent can
  keep, instead of a gesture the renderer forgot. Pairs naturally with D-B: same
  dataset, now bidirectional.
- Needs: desktop app running. Spatial: same loop, spatial-side status: see
  `viewer-spatial`.

### D-H — Checklist checkbox toggle → agent receives `checkbox_toggled`
**Claim:** the human checks an item off a status report and the agent reacts.
- **View:** a markdown checklist / status report with checkboxes
  (`run_generator { slug: 'status_report' }`, or a `markdown` View with `- [ ]`
  items) in the desktop window.
- **Gesture:** tick a checkbox — e.g. *"Restart scene server"*.
- **Event the agent receives:**
  ```jsonc
  { "viewId": "status", "type": "markdown", "action": "checkbox_toggled",
    "data": { "itemId": "restart-scene-server", "checked": true },
    "ts": "2026-06-06T11:08:44.901Z" }
  ```
- **Agent reaction (visible):** the agent acknowledges (`notify "✓ restart-scene-
  server"`) or advances its own workflow off the human's check. A checklist the
  human and agent share, live.
- Needs: desktop app running. Spatial: same loop, spatial-side status: see
  `viewer-spatial`.

> **The payload is one frozen contract** across all three (and across both shells):
> `{ viewId, type, action, data, ts }`, `action ∈ card_moved | card_edited |
> node_moved | checkbox_toggled | cell_edited`. The agent declares ONE
> `view_event` inbox and handles every gesture through it. Full contract:
> `docs/AGENTS.md` §4.

---

## 5. What I deliberately did NOT build (the second-look discipline)

Per your quote ("don't optimize a thing that shouldn't exist"), I cut these on purpose:
- **A net-new 3D graph** — yours already existed; I unified the data instead.
- **A generator sync-script / codegen** — both shells resolve slugs straight from
  the shared registry (desktop `run_generator` mesh surface; spatial
  `/generators/{slug}/run`), so there's nothing to build.
- **A session persistence engine** — in-memory is enough until proven otherwise.

The scene-server `/scenes` (native 3D entities) and `/generators` (portable Views) registries BOTH stay — they do genuinely different things (3D scene content vs cross-device 2D Views). I did NOT merge them; I made AGENTS.md crystal-clear about which to reach for. Merging the mental model, not the code.

---

## 6. Go-live runbook (when you want the nodes on the REAL mesh)
I kept the live mesh untouched overnight. To promote:
1. Add `VIEWER_DESKTOP_SECRET` / `VIEWER_SPATIAL_SECRET` / `VIEWER_SESSION_SECRET` to `RAVEN_LATTICE/hosts/mac-mini/.env`.
2. Splice the blocks from `manifest.viewer-nodes.yaml` into `manifest.yaml`.
3. `core.reload_manifest`.
4. Launch viewer_spatial + viewer_session Python nodes; viewer_desktop is in-process with the Electron app.
(Exact instructions in the manifest-validate worker's summary.)
