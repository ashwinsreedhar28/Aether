# Integration notes — `integ/raven-frontend`

This branch stages the **viewer-desktop** Electron frontend into Aether under `viewer-desktop/`, untouched and namespaced, so it never collides with Aether's own tree and the build is **not** expected to pass. Nothing here resolves a collision — where viewer and Aether both implement something, **both are present on purpose** for the architect to rule deliberately. Commits are scoped one-per-capability (see `git log aether/main..integ/raven-frontend`). The source repo (`coltonkirsten/viewer-desktop`) was left completely untouched.

Below, per capability: what it does · what I'd fight to keep · what it assumes about the backend/transport · where it overlaps Aether.

### Surface layer — workspace/window/tab manager  (commit 2)
A real desktop window manager: workspaces ▸ windows ▸ tabs, drag/resize/tiling, file explorer with live `@parcel/watcher` watching, dock, workspace switcher, all backed by Zustand stores with debounced persistence. **Fight to keep — this is the crown jewel** and the thing Aether's `shell/` does not have. Assumes only the Electron host + IPC below it; no mesh dependency. **Overlap:** Aether's holographic `shell/` renderer and the AVP scene server both lay out panels. Proposal: Viewer's workspace store becomes the layout authority and the scene server is demoted to an adapter (or dropped).

### App registry — "every screen is an app"  (commit 3)
`AppDefinition` + `import.meta.glob` auto-discovery (`AppContext`/`AppWrapper`/`ContentHost`) and ~20 curated content apps (text/markdown/json/pdf/image/html/latex viewers, terminal, browser, kanban, knowledge-graph, etc.). **Fight to keep** — this is the structural bridge to the merge thesis: an *app is a capability with a UI surface*. Assumes the surface layer for window/tab context; no backend. **Overlap:** nothing in Aether yet — this is the missing primitive. (One gap: `import.meta.glob` is build-time; mesh-built apps will need a runtime registration hook.)

### Mesh node SDK (TypeScript)  (commit 4)
viewer's own `MeshNode` client — register, sign envelopes, invoke surfaces. Standalone. **Directly overlaps Aether `core/node_sdk_ts`.** I would *not* fight for this one; it exists so the architect can diff the two SDKs and pick. Assumes an HMAC mesh with Core at a `coreUrl`.

### Transport seam — viewer node + control bridge  (commit 5)
The frontend↔backend wiring: a `ViewerNode` that registers on Aether Core and exposes shared surfaces (`run_generator`, `open_view`, `close_view`, `focus_view`, `list_views`, `notify`, plus in-progress `*_window` payloads), the `executeViewerControl` dispatch into the renderer, a local control server, and the renderer-side `controlBridge` that emits `view_event` back to agents. **Fight to keep the *shape*** (agents drive windows over the mesh; the renderer feeds interaction events back) even if the implementation is reworked. Assumes HMAC mesh + reachable Core. **Overlap:** Aether shell's own mesh client/registration — this is where Viewer stops being a guest node and becomes *the shell*.

### cmd-/ Claude command palette  (commit 6)
A streaming `Cmd+/` assistant on the Claude Agent SDK, with OAuth and automatic workspace context (current file, root dir, open files). **Fight to keep** — it's the seed of "the assistant *is* Aether," and it already spawns agentic work (the natural entry point to Aether's self-build loop). Assumes a Claude Agent SDK runtime. **Overlap:** Aether's **Raven** (Gemini Live voice). Proposal: unify at the *tool-dispatch* layer, keep both model runtimes (Claude for building, Gemini for low-latency voice).

### Voice + audio feedback  (commit 7)
Whisper dictation overlay and a Web-Audio feedback engine (synthesized sounds for window/tab/workspace events). Mild keep — the audio feedback is a nice touch; the dictation **overlaps Raven's voice** and is much lighter, so it likely gets demoted to audio-feedback only.

### Excluded (curated out)
airplane-physics, optics (3D demos) and the entire Leap Motion stack (hardware hand-tracking: `src/leap`, `components/Leap`, `leap-settings`, `leapStore`, `leapServiceHandlers`) — demos/hardware, not load-bearing. Note: Leap is still *imported* by `src/App.tsx`, `electron/main/index.ts`, and `electron/preload/index.ts`, so those imports dangle. That's intentional and harmless here (build is not required to pass); the architect can prune the references when the host process is reconciled.
