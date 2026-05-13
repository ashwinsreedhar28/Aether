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

## [2026-05-12] Mesh awakened: minimum end-to-end skeleton

**Status:** accepted
**Decided by:** Architect (approved by Director)
**Context:** The shell now has multiple surfaces (Welcome / News / Mesh)
and the next wave of capabilities — real data feeds, voice, agents —
each need permissioned IPC. The top-down strategy from PR #1's ADR
deferred the mesh until "Day 5+ once there are actually multiple things
to connect." That bar is met. RAVEN_MESH's edge-graph authorization
(manifest line ⇒ permitted; no line ⇒ denied — `MASTER_SYNTHESIS.md §1.2`,
`_ingest/RAVEN_MESH/docs/PHILOSOPHY.md §1`) is the load-bearing primitive
every future capability will sit on; waking it now with one trivial node
end-to-end proves the spine and gates v0.1.0.

**Decision:** Adopt RAVEN_MESH protocol unchanged (`_ingest/RAVEN_MESH`
SHA `464ee809…`) and vendor its protocol layer to `core/`. Port the
Python SDK to TypeScript at `core/node_sdk_ts/` so the Electron main
process and Node.js mesh nodes can speak the wire format. Use a
daemon-manager pattern (lifted from
`_ingest/VIEWER/apps/viewer/electron/main/services/daemonManager.ts`)
to spawn the Python Core + each Node.js node from the shell's
`app.whenReady`. Declare the topology in a single `manifest.yaml` at
repo root with three nodes — `shell`, `host_notifications`, and the
implicit reserved `core` — and one edge: `shell → host_notifications.notify`.
Ship the first real node (`nodes/host_notifications/`) firing native
macOS notifications via `osascript`, plus a `mesh-devtools` app on the
canvas to drive a round-trip from the renderer.

**Consequences:**
- Shell now hard-depends on Core to boot. If Core fails its 30s
  health-check, the shell shows an error dialog and quits. Graceful-
  degradation (run renderer-only when mesh is down) is deferred — once
  multiple substrates exist we'll have something to degrade *to*.
- Identity secrets live in process env vars per RAVEN_MESH defaults; the
  shell generates fresh hex-32 values per cold start (`coreSecret`,
  `shellSecret`, `hostNotificationsSecret`, plus `ADMIN_TOKEN`) and
  injects them into spawned children. Not persisted across runs. Keychain
  integration is a follow-up (`MASTER_SYNTHESIS.md §7 Q6`).
- Renderer ↔ main IPC stays on `contextBridge` (`shell:metadata`,
  `mesh:invoke`, `mesh:status`). Mesh is for main-process-and-out, not
  for renderer-to-main hot paths — matches `MASTER_SYNTHESIS.md §4.1`.
- Vendored Core requires `aiohttp`, `pyyaml`, `jsonschema` from system
  Python; coreManager surfaces a clear failure message if missing.
  Documented in `core/README.md`.
- Cross-platform debt: `host_notifications` is macOS-only this PR
  (returns `MeshDeny` on other platforms). The collaborator's Windows
  tree handles the Windows path in their own PR (CLAUDE.md §11 #7).
- The TypeScript SDK port lives at `core/node_sdk_ts/`. ~370 LOC across
  canonical / types / MeshNode / index files; longer than the Python's
  310 LOC mostly because of explicit type declarations and the hand-
  rolled SSE consumer that replaces aiohttp's `r.content.readline()`.
  The round-trip vitest boots Core in a subprocess and proves the wire
  is HMAC-signature-identical to the Python SDK.

**Alternatives considered:**
- *Keep IPC-only (no mesh)* — rejected: no auth, no edge model, won't
  scale to agents or third-party nodes. `MASTER_SYNTHESIS.md §3.2`.
- *Mesh-everywhere including renderer↔main* — rejected per
  `MASTER_SYNTHESIS.md §4.1` recommendation. The renderer/main hot path
  doesn't need HMAC overhead or graph mediation; everything else does.
- *Spawn Core on-demand via supervisor* — `core/core/supervisor.py` is
  vendored but not wired up. Always-spawned-by-shell is simpler for
  v0.1.0; revisit when multi-mesh or detached substrate machines arrive
  (`MASTER_SYNTHESIS.md §6`).
- *Adopt RAVEN_MESH as a runtime dep instead of vendoring* — rejected:
  the protocol is the contract, and we want the freedom to bump the
  vendored SHA in dedicated chore PRs without merging upstream's commit
  cadence into our history.
- *Embed Python Core via PyO3 / Pyodide-in-Electron* — rejected as
  premature optimization. Subprocess spawn is fast enough (Core warm
  in ~200ms in dev) and matches RAVEN_MESH's deployment model.
- *Persist secrets to disk in `data/`* — rejected for this PR; ephemeral
  per-launch secrets are strictly safer until Keychain integration lands.
