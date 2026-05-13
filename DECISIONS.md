# Decisions

Append-only Architecture Decision Records. Format and rules per CLAUDE.md §8.
Never edit a past entry — supersede with a new one.

---

## [2026-05-12] Top-down build strategy in week 1

**Status:** accepted
**Decided by:** Architect (approved by Director)
**Context:** Two viable build orders for the homeOS skeleton:
*bottom-up* (vendor RAVEN_MESH first, write the TS SDK, manifest validator,
ship Core, only then build a renderer) or *top-down* (visible Electron shell
on Day 1, fake the backend, add real services behind the fakes incrementally).
Director attention is the project's binding constraint, not Claude Code
throughput — plumbing-first work gives nothing to react to for days and kills
momentum.
**Decision:** Top-down for week 1. Build the Electron shell first, fake the
backend, wake the mesh ("the spine") on Day 5+ once there are actually
multiple things to connect. The visible surface drives direction; direction
drives architecture.
**Consequences:**
- We deviate from `MASTER_SYNTHESIS.md §6`'s phase ordering for week 1.
  That ordering remains correct for a production push and we converge once
  the shell has multiple surfaces. This ADR records the divergence.
- `core/`, `manifest.yaml`, `nodes/` (per CLAUDE.md §4 target layout) stay
  unbuilt until earned.
- Acceptable risk: the eventual mesh-everywhere refactor will touch the
  shell's IPC surface. Mitigation: keep the renderer/main contract tiny
  (currently two channels — `shell:renderer-ready`, `shell:metadata`) so the
  refactor is mechanical.
**Alternatives considered:**
- *Bottom-up* — rejected for the attention-bottleneck reason above.
- *Parallel* (shell + Core in lockstep, two PRs/week) — rejected as too
  ambitious for a solo dev in week 1.

---

## [2026-05-12] Package manager: pnpm

**Status:** accepted
**Decided by:** Architect (codified in CLAUDE.md §10)
**Context:** Three viable choices — npm, yarn, pnpm. Pulse uses npm; VIEWER
uses pnpm; NEXUS uses npm.
**Decision:** pnpm. Activated via Node 20's built-in `corepack` (no global
install required); the `packageManager` field in `shell/package.json` pins
the version (`pnpm@9.15.0`).
**Consequences:**
- Faster installs, deterministic lockfile, easier monorepo evolution when
  `nodes/` and `core/` arrive.
- Contributors need `corepack enable` once. Documented in the PR's
  "Verification" notes.
**Alternatives considered:**
- *npm* — slower for monorepos and the lockfile churn is worse. Rejected.
- *yarn* — no advantage over pnpm for our shape. Rejected.

---

## [2026-05-12] Holographic theme adopted from VIEWER

**Status:** accepted
**Decided by:** Architect (specified in CLAUDE.md §11)
**Context:** The shell needs a coherent visual identity from Day 1
(CLAUDE.md §14: "the holographic theme is not decoration — it is the thing
Director will stare at while directing"). VIEWER already ships a fully
worked-out holographic palette (`#0a0a0f` background, `#4a9eff` accent,
`rgba(100,150,255,0.2)` borders, etc.) under MIT.
**Decision:** Adopt VIEWER's CSS-variable palette verbatim:
`--holo-bg`, `--holo-text`, `--holo-muted`, `--holo-accent`, `--holo-border`,
`--holo-panel`, `--holo-glow`, `--holo-accent-rgb`. The five required by
CLAUDE.md §11 plus the three that VIEWER's idioms reference together.
File: `shell/src/theme/holographic.css` carries the attribution comment.
**Consequences:**
- Apps lifted from VIEWER (per `MASTER_SYNTHESIS.md` §3.3 — `markdown-editor`,
  `terminal`, `kanban`, `agent-manager`, etc.) drop in without re-derivation.
- Brand cohesion across surfaces (tray icon dot, splash dot, welcome window
  accent all use `--holo-accent`).
- Acceptable risk: if homeOS later diverges visually from VIEWER, this ADR
  is superseded by a new one defining the homeOS palette.
**Alternatives considered:**
- *Derive a fresh palette from scratch* — rejected as week-1 over-investment;
  VIEWER's values are already polished.
- *Use Tailwind defaults only* — rejected; reads as "dev tool", not "Jarvis."

---

## [2026-05-12] Tray click behaviour deferred until background mode

**Status:** accepted
**Decided by:** Architect
**Context:** PR #1 ships a tray icon whose click handler currently re-opens
the welcome window. Because window-all-closed quits the app in week 1, a
tray click after window close is effectively startup.
**Decision:** Leave current behaviour as-is for v0.0.x. When a future PR
introduces "background mode" (app survives all windows closed), tray click
must change to focus-or-reopen-without-restart semantics rather than full
process restart.
**Consequences:** A small tray-handler refactor when background mode lands.
Flagged here so it's not forgotten.
**Alternatives considered:** Implementing background mode in this PR —
rejected as out of scope per CLAUDE.md §11 DON'T list.

---

## [2026-05-12] `_ingest/` adopted as git submodules

**Status:** accepted
**Decided by:** Architect (approved by Director)
**Context:** Previous ADRs deferred this question (PR #1 gitignored
`_ingest/`, planned to revisit "if drift bites"). Drift bites now — every
new task spec cites file paths and line numbers under `_ingest/`, and
those citations rot the moment any of the four upstreams move. Two
viable alternatives, both worse: *vendor* the repos (strip inner `.git`,
commit everything — bloats homeOS history with ~thousands of files and
re-creates the drift problem manually) or *keep ignored* (current state
— Director and collaborator end up at different upstream SHAs, MASTER_SYNTHESIS.md
citations diverge silently). Submodules pin specific SHAs in homeOS history;
clone + `git submodule update --init --recursive` reproduces the exact
reference state on any machine.
**Decision:** Convert `_ingest/{Pulse, RAVEN_MESH, NEXUS, VIEWER}` to
git submodules pinned to these SHAs:

| Submodule | URL | Pinned SHA |
|---|---|---|
| `_ingest/Pulse` | `https://github.com/ashwinsreedhar28/Pulse.git` | `842a8bde7a9c3aee8b7b154d3e631f56a0588791` |
| `_ingest/RAVEN_MESH` | `https://github.com/coltonkirsten/RAVEN_MESH.git` | `464ee80911739019663589d75bd2d6f58a45afee` |
| `_ingest/NEXUS` | `https://github.com/R-A-V-E-N-delegate/nexus.git` | `4d2a6f6d271ccd6b977e6ecfba39dbc4cc60b473` |
| `_ingest/VIEWER` | `https://github.com/R-A-V-E-N-delegate/viewer.git` | `9c58664ec652c836595ac48e9f75d2439272657e` |

All four URLs are HTTPS (no SSH-key requirement on collaborator's
machine), all four upstreams are public at the time of this decision
(Pulse was made public by Director during the PR — previously private).
**Consequences:** Clone workflow gains a step:
`git clone <homeOS> && cd <homeOS> && git submodule update --init --recursive`.
Documented in this PR's Verification block. `.gitignore` no longer hides
`_ingest/`; `.gitmodules` at repo root holds the four submodule entries.
**Accepted risk:** If an upstream force-pushes or rewrites history past
our pinned SHA, our pointer orphans and `submodule update` fails for
anyone who hasn't already fetched. *Mitigation:* if any source proves
fragile, fork it into our own org as a follow-up PR and re-point the
submodule URL there. None of the four show any sign of doing this today.
**Alternatives considered:**
- *Vendor (strip inner .git, commit everything)* — rejected: ~thousands
  of files of bloat in homeOS history, and re-introduces drift manually
  every time we want to refresh.
- *Keep gitignored* (the previous state) — rejected: every citation in
  `MASTER_SYNTHESIS.md` and future task specs is effectively meaningless
  across machines.

---

## [2026-05-12] App-discovery system: VIEWER pattern adopted, single-window for now

**Status:** accepted
**Decided by:** Architect (approved by Director)
**Context:** Shell needs more than one surface — every future content app
(finance, sports, markdown editor, agent-manager, …) has to be a folder
drop, not a core refactor. VIEWER already ships exactly the pattern we
need: `import.meta.glob('./*/index.ts', { eager: true })` against
`src/apps/`, each app folder exporting `app: AppDefinition`. The full
VIEWER registry layers on file-type routing, dynamic register/unregister,
and a per-app `AppContext` / `AppWrapper` for window + tab state —
load-bearing for VIEWER's multi-window workspace, all out-of-scope for
us today.
**Decision:** Adopt VIEWER's `import.meta.glob` + `AppDefinition`
pattern, simplified ruthlessly:
- `AppDefinition` keeps `id`, `name`, `icon`, `component`, optional
  `defaultSize`. No `fileTypes` (no file-based apps yet). Component is
  zero-arg (no `AppProps` — single-window, no per-instance props).
- Registry exposes only `getApps()` and `getApp(id)`. No
  `getAppForFile`, no `getFileTypeMapping`, no `registerApp` /
  `unregisterApp`.
- A tiny Zustand store (`useActiveApp`) holds a single `activeAppId`
  string. Default `'welcome'`. State is non-persistent — resets to
  default on relaunch.
- A thin top-nav in `App.tsx` lists discovered apps and swaps the
  active component on click. Previous app unmounts when the active
  switches (no keep-alive yet).
**Consequences:**
- Adding an app is now a folder drop. Verified end-to-end in PR #5 by
  staging a `test-app` stub, confirming it appeared in the renderer
  bundle after a build, then deleting before commit.
- Multi-window, tabs, drag-resize, persisted active-app state — all
  later PRs.
- Active app's `getMetadata` (Welcome) IPC will re-fire on every
  switch-back. Acceptably cheap (a single in-process IPC call); the
  alternative (caching layer / hoisted state) is YAGNI for week 1.
**Alternatives considered:**
- *Route-based (react-router)* — rejected: pulls in a router for what
  amounts to a single conditional render. More mass than needed.
- *Full VIEWER port (windows / tabs / file routing / AppContext)* —
  rejected as week-1 over-investment. VIEWER's multi-window stack is
  what we converge to, not what we start with.

**Future directions:** Icon resolution currently routes through an
`ICON_MAP` keyed by lucide-react icon name string. At ~10 apps, migrate
to per-app `ComponentType` imports — every app's `index.ts` imports its
own icon directly, `AppDefinition.icon` becomes
`ComponentType<{ size?: number }>` rather than `string`, and the central
map disappears. Eliminates the registry-update friction of adding each
new icon.

---

## [2026-05-12] PR comments adopted as primary review channel; review heuristics codified

**Status:** accepted
**Decided by:** Director (acting on Architect's proposal)
**Context:** PRs #1–#5 routed every Architect note through Director-as-
postal-service: Architect's chat reply → Director paste into the next
chat with Claude Code → Claude Code reads → fix → push → Director relays
again. Friction compounded across review rounds. Director wanted
attention reserved for direction, visual verification, and merge — not
relay duties. At the same time, recurring review patterns (nav ordering,
traffic-light insets, comment/code drift, destructive-op pre-flight,
git-status column semantics) kept surfacing post-PR rather than
pre-PR — every one a saveable round-trip.
**Decision:** Two changes shipping together:
- Architect chat replies → Director paste as a single PR comment →
  Claude Code reads via `gh pr view <n> --comments`. Review
  *conversation* lives on the PR; chat between Director and Architect
  reserved for direction-level decisions and visual-test feedback.
- Review heuristics extracted from PR #1–#5 feedback patterns and
  added to CLAUDE.md §11 (replacing the now-shipped First Task spec)
  for self-application before opening any PR. §7 self-review template
  gains a "Pre-PR heuristics" prompt so the checklist is run for real.
**Consequences:**
- Director paste-load drops by ~half on clean PRs and more on
  review-cycle PRs.
- Architect's review history lives on the PR (better audit trail; one
  click instead of chat-scrolling).
- Heuristics list grows as patterns recur — each future entry is a
  follow-up PR, not an upfront design exercise.
- §11 slot reused, not inserted. Section numbering after §11 unchanged.
**Alternatives considered:**
- *Status quo* — rejected, friction compounds across review rounds.
- *GitHub Action wiring Architect chat → PR comment directly* —
  rejected as week-1 over-investment. Revisit when paste load becomes
  a measurable bottleneck again.

---

## [2026-05-12] Voice via daemon pattern; mesh rebase deferred

**Status:** accepted
**Decided by:** Architect (approved by Director); flagged by Implementer
**Context:** Voice has a tight latency budget (sub-second feel), needs
to own audio devices and an LLM session, and benefits from surviving
shell restarts where possible. The mesh ("the spine") is not yet
implemented — Lane 1's `core/` work is parallel and not load-bearing
for this PR. Two ways to add voice now:
1. Wait for Lane 1's mesh to land, then build voice as a mesh node.
2. Ship voice immediately using VIEWER's existing detached-daemon
   pattern (Node.js HTTP+WS supervisor → Python child running the
   live-audio loop). Rebase to mesh as a small follow-up PR once Lane
   1's `core/` is in place.

The brief specified path 2 to keep both lanes moving in parallel.

**Sub-context (LLM provider — implementer-flagged discrepancy):**
The task brief described the LLM as **Cerebras**. The code in
`_ingest/VIEWER/apps/raven/` actually uses **Google Gemini Live API**
(`gemini-2.5-flash-native-audio-preview-09-2025`) for the voice loop;
Cerebras appears only inside `cerebras_tool.py` as a side tool for
generating HTML/visual content (it is not the conversational LLM and
does not handle audio). Cerebras has no live-audio API today that
matches what VIEWER's `orchestrator.py` consumes — swapping the
provider would be a substantial rewrite, not a configuration change.
Per CLAUDE.md §13, this is the "Architect intent vs. code reality"
case: the implementer goes with the code reality and flags loudly.
This ADR is that flag.

**Decision:** Ship voice using VIEWER's daemon pattern intact.
- Vendor `_ingest/VIEWER/apps/raven-daemon` → `daemons/raven-daemon/`
  (Node.js HTTP+WS on `127.0.0.1:7433`).
- Vendor `_ingest/VIEWER/apps/raven` → `daemons/raven-core/` (Python
  Flask-free runtime — Flask sidecar was dead code and removed).
- Shell's `ravenDaemonManager` spawns the Node daemon detached;
  the daemon supervises the Python child via `child_process.spawn`.
- Two tools enabled this PR: `time_tool`, `memory_tool`. Other
  vendored tools (`cerebras_tool`, `silence_tool`, `system_tool`)
  remain on disk but are not registered.
- LLM: **Gemini Live API** (env var: `GEMINI_API_KEY`). The brief's
  Cerebras-shaped framing is preserved in the open-questions section
  of the PR so Architect can confirm or redirect.

**Consequences:**
- Voice runs without mesh. Tool calls dispatch directly via Python
  function calls — no envelope signing, no edge graph, no audit log
  yet. Acceptable because the surface is local-loopback only and the
  enabled tools are read-only (time) or scoped-disk (memory).
- Rebase-to-mesh follow-up PR will swap `raven_core/tools/__init__.py`'s
  direct-Python `handle_function_call` for `mesh.invoke()` against the
  appropriate node surface. This is well-scoped because the rest of
  the daemon is mesh-agnostic.
- Audio-permission prompt on first launch (one-time macOS system
  dialog). Unavoidable; persistent thereafter.
- First-launch latency: ~30s for the Python `venv` install + `pip
  install -r requirements.txt`. Subsequent launches are ~1–2s.
  Splash is non-blocking on this (voice boots in parallel with reveal)
  so the shell still paints quickly; the Voice app pill shows
  `voice: offline → voice: ready` when the daemon comes up.
- `GEMINI_API_KEY` is required. Without it the shell still loads,
  Voice app shows red `voice: missing GEMINI_API_KEY`, every other
  app works normally. If Director prefers `CEREBRAS_API_KEY` semantics
  for compatibility with the brief, we add a thin alias before
  reading; flagged for review.
- macOS-only this PR. Daemon spawn is gated on
  `process.platform === 'darwin'`; other platforms surface
  `voice: macOS only in this build`.

**Alternatives considered:**
- *Wait for Lane 1's mesh to land first* — rejected; defeats
  parallelisation and delays the highest-value Jarvis-feeling demo.
- *Skip voice entirely until mesh lands* — rejected; voice is the
  surface most likely to drive direction from the Director.
- *Use Cerebras as the conversational LLM* — rejected as out-of-scope
  rewrite; flagged in PR open-questions for Architect to confirm or
  redirect.
- *Use the Cerebras sub-tool path (`call_cerebra` for HTML)* —
  deferred along with the rest of the disabled tool set; not load-
  bearing for the two-tool demo.
