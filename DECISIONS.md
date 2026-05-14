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

## [2026-05-12] File-based apps pattern: `fileTypes` on `AppDefinition`, `fileApi` on preload

**Status:** accepted
**Decided by:** Architect (approved by Director)
**Context:** `MASTER_SYNTHESIS.md §1.4` establishes file-as-source-of-truth
as a doctrine homeOS inherits from VIEWER — content apps shouldn't own their
data, they should render files on disk. The previous app-discovery ADR
explicitly deferred this ("no `fileTypes` — week 1 has no file-based apps")
because the markdown viewer hadn't landed. It now has, and future content
apps (JSON viewer, ticker `.csv` view, PDF reader, the morning-brief
output) all want the same shape. Doing this once, now, is cheaper than
retrofitting four apps later.
**Decision:**
- Extend `AppDefinition` with `fileTypes?: string[]` (lowercase extensions
  without leading dot, e.g. `['md', 'markdown']`) and a forward-looking
  `iconForFile?: (path) => string` (per-file icon override; no consumer
  reads it yet but file-based apps can declare it now).
- Add `getAppsForFileType(ext): AppDefinition[]` to `app-registry.ts`,
  sorted by `order` so the first entry is the eventual default
  renderer. Case-insensitive, leading-dot tolerated.
- Expose a `window.homeOS.files` namespace on the preload:
  - `openDialog({ filters? }): Promise<string | null>` — native open-file
    dialog, returns absolute path or null on cancel.
  - `readText(path): Promise<string>` — UTF-8 read with a 1 MiB cap
    (stat-then-read so oversized files reject precisely instead of
    OOMing), enforcing an allowlist of `os.homedir()`, `app.getPath('userData')`,
    `app.getPath('downloads')`, `app.getPath('temp')`. Path resolved with
    `path.resolve` and prefix-checked with `sep` boundary to defeat
    `..` segments and sibling-prefix tricks.
- No file-router consumer wired yet. The helper exists so the future file
  explorer / drag-drop surface needs no app-side change to route opens.
**Consequences:**
- Any future file-based app declares its `fileTypes` and uses the same
  `homeOS.files` surface — no per-app IPC.
- The 1 MiB cap is the renderer's load-bearing contract. Larger files
  need a lazy/virtualised rendering layer (future PR) before the cap
  raises.
- The dialog acts as the trust boundary for user-chosen files; the
  allowlist is the defence-in-depth against direct `readText` calls
  (DevTools console, future buggy callers). The Open Question in the
  task spec is resolved in favour of the broader allowlist
  (home + userData + downloads + temp) rather than the narrower
  home-only variant — `/tmp` and `~/Downloads` are normal places to
  drop a markdown file.
- Renderer bundle grew from ~250 KB to ~953 KB (react-markdown +
  unified + remark-gfm). Code-split deferred deliberately: parse/exec
  is <100 ms on M-series from local disk, and a `React.lazy` boundary
  needs holographic loading-state design that isn't worth picking up
  now. Revisit as a single dep-audit / code-split PR at ~3 MB total
  or if first-paint feels slow (whichever comes first); voice (Lane 3)
  is the next likely weight bump.
**Alternatives considered:**
- *File-explorer-as-router* (the router resolves extensions at open
  time and ignores `fileTypes` on apps) — rejected: premature without
  an explorer, and apps still need to advertise what they can render.
- *Hardcoded routing per-app* (no `fileTypes`, file explorer maintains
  its own map) — rejected: doesn't scale past three apps, and forks
  ownership of the mapping out of the app folder.
- *Narrow allowlist (home + userData only)* — rejected per the task
  spec's open question: `/tmp` and `~/Downloads` are normal user-pick
  locations. Allowlist is now home + userData + downloads + temp.

---

## [2026-05-12] CI infrastructure: GitHub Actions for trivial checks, manual branch protection for policy enforcement

**Status:** accepted
**Decided by:** Architect (approved by Director)
**Context:** Director described a "pipeline of constant reviewing" —
PRs #1–#5 had Claude Code running `pnpm typecheck`, `pnpm lint`, and
`pnpm build` manually for every PR, and Architect chasing the output
during review. That's wasteful when a CI runner does it for free on
every push. Separately, CLAUDE.md §5 says "you never push to `main`
directly" — currently a convention, not enforced. GitHub branch
protection rules are the standard mechanism for mechanical
enforcement, but they are not repo-file configurable (no YAML in the
repo can set them — the rules live in repo settings, set via UI or
the GitHub API).
**Decision:** Two pieces, shipping together:
- GitHub Actions for the automated runs. Single workflow
  (`.github/workflows/ci.yml`), single job `checks`, steps for
  `shell/` install + typecheck + lint + build. A conditional
  `core/node_sdk_ts/` block lights up automatically once Lane 1 adds
  that package.
- Branch protection rules configured **manually** through the GitHub
  UI per `docs/BRANCH_PROTECTION.md`. The doc captures the exact
  settings (require PR, require `checks` green, no force push, no
  bypass even for admins) so reproduction is one pass.
**Consequences:**
- Every PR gets auto-checked from open onward; failing checks block
  merge once branch protection is on. Architect review concentrates
  on design, not "did typecheck pass."
- Adding a future package under `core/` or elsewhere requires
  extending the workflow (additive — name new steps clearly to keep
  the file readable).
- Branch protection setup is a one-time Director action, not in
  Claude Code's scope. Documented in `docs/BRANCH_PROTECTION.md` so
  it's reproducible across machines / future repos.
- PR template (`.github/pull_request_template.md`) auto-fills CLAUDE.md
  §7's self-review structure on every new PR — fewer "you forgot the
  template" review rounds.
**Alternatives considered:**
- *Pre-commit hooks (husky / lefthook)* — rejected: easy to bypass
  with `git commit --no-verify`, runs only on the contributor's
  machine, and doesn't catch on the canonical branch. CI on the
  remote is the right enforcement boundary.
- *CircleCI / other runners* — rejected: GitHub Actions is free for
  this repo's tier and we're already on GitHub. No reason to add a
  second vendor.
- *Setting branch protection from a workflow* — rejected as
  impossible: GitHub branch protection rules cannot be configured by
  a repo file (the protection settings live in repo metadata, not
  source). The closest options (a workflow that calls the GitHub API
  on every push) introduce a chicken-and-egg problem and are worse
  than a five-minute UI setup.

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
- Mesh boot runs in parallel with the splash → reveal sequence; it
  is NOT on the critical path. The shell remains usable for non-mesh
  apps (Welcome / News / Markdown) even if Core fails to start —
  the Mesh Dev Tools status pill shows `starting` / `online` /
  `failed` / `offline`, and an error dialog surfaces on failure
  without quitting the app. The earlier "hard-depend, quit on
  failure" sequencing was reversed during smoke-test (Architect
  feedback on PR #10) when it regressed PR #1's splash → reveal
  timing.
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

---

## [2026-05-12] Voice via daemon pattern; mesh rebase deferred

**Status:** accepted
**Decided by:** Architect (approved by Director); flagged by Implementer
**Context:** Voice has a tight latency budget (sub-second feel), needs
to own audio devices and an LLM session, and benefits from surviving
shell restarts where possible. This PR was scoped before Lane 1's
`core/` mesh substrate landed (it has since merged in PR #10).
Two ways to add voice:
1. Wait for the mesh, then build voice as a mesh node.
2. Ship voice immediately using VIEWER's existing detached-daemon
   pattern (Node.js HTTP+WS supervisor → Python child running the
   live-audio loop). Rebase to mesh as a small follow-up PR.

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
This ADR is that flag; Architect confirmed Gemini at PR review.

**Decision:** Ship voice using VIEWER's daemon pattern intact.
- Vendor `_ingest/VIEWER/apps/raven-daemon` → `daemons/raven-daemon/`
  (Node.js HTTP+WS on `127.0.0.1:7433`, loopback-only).
- Vendor `_ingest/VIEWER/apps/raven` → `daemons/raven-core/` (Python
  Flask-free runtime — Flask sidecar was dead code and removed).
- Shell's `ravenDaemonManager` spawns the Node daemon detached;
  the daemon supervises the Python child via `child_process.spawn`.
  Boot ordering vs. the mesh's `coreManager`: Core first
  (load-bearing for mesh-dependent apps), then raven (degrades
  gracefully — Voice app surfaces an "unavailable" pill if the
  daemon fails to start). Both are off the splash → reveal critical
  path; both are torn down in parallel via `Promise.allSettled` on
  `before-quit`.
- Two tools enabled this PR: `time_tool`, `memory_tool`. Other
  vendored tools (`cerebras_tool`, `silence_tool`, `system_tool`)
  remain on disk but are not registered.
- LLM: **Gemini Live API** (env var: `GEMINI_API_KEY`).

**Consequences:**
- Voice runs without mesh. Tool calls dispatch directly via Python
  function calls — no envelope signing, no edge graph, no audit log
  yet. Acceptable because the surface is local-loopback only and the
  enabled tools are read-only (time) or scoped-disk (memory).
- Rebase-to-mesh follow-up (`feat/voice-mesh-rebase`) will swap
  `raven_core/tools/__init__.py`'s direct-Python `handle_function_call`
  for `mesh.invoke()` against the appropriate node surfaces, and add
  the voice daemon to `manifest.yaml` with its own edge declarations.
  Well-scoped because the rest of the daemon is mesh-agnostic.
- Audio-permission prompt on first launch (one-time macOS system
  dialog). Unavoidable; persistent thereafter.
- First-launch latency: ~30s for the Python `venv` install + `pip
  install -r requirements.txt`. Subsequent launches are ~1–2s.
  Bootstrap is async (Promise-based spawn — `spawnSync` would freeze
  Electron's main thread for the full 30s, tripping the network
  service watchdog and producing a black screen).
- `GEMINI_API_KEY` is required. Without it the shell still loads,
  Voice app shows red `voice: missing GEMINI_API_KEY`, every other
  app works normally.
- macOS-only this PR. Daemon spawn is gated on
  `process.platform === 'darwin'`; other platforms surface
  `voice: macOS only in this build`.
- Echo trade-off documented separately: while playing audio out, the
  mic is gated (`_playback_until` monotonic timestamp) to prevent
  the MacBook speaker from feeding back into the mic and triggering
  false interruptions. Consequence: no barge-in. `fix/voice-barge-in`
  follow-up will swap this for Apple `voiceProcessingIO` AEC.
- `pyaudio` requires `brew install portaudio` once per developer
  machine; the bootstrap detects the missing-header signature in the
  pip output and rewrites the pill reason to surface the brew
  command.

**Alternatives considered:**
- *Wait for the mesh to land first* — rejected; defeats
  parallelisation and delays the highest-value Jarvis-feeling demo.
- *Skip voice entirely until mesh lands* — rejected; voice is the
  surface most likely to drive direction from the Director.
- *Use Cerebras as the conversational LLM* — rejected as out-of-scope
  rewrite. Cerebras has no live-audio API today.
- *Use the Cerebras sub-tool path (`call_cerebra` for HTML)* —
  deferred along with the rest of the disabled tool set; not load-
  bearing for the two-tool demo.

---

## [2026-05-13] Director-authorized execution: codify the delegation pattern

**Status:** accepted
**Decided by:** Architect (drift surfaced by voice PR Implementer)
**Context:** CLAUDE.md §1 ("Director merges") and §12 ("Don't ever: Merge
your own PR") read literally as a prohibition on Implementer running
`gh pr merge` or `git push origin <tag>`. Actual practice across PRs #2,
#4, #5, #6, #7, #8, #10 has been Implementer executing both commands
under Director's explicit chat-authorization ("paste this to Claude Code:
gh pr merge X"). The drift wasn't malicious or accidental — it was the
pragmatic path because Architect (a chat session) physically cannot push
to GitHub, and Director was comfortable delegating the mechanical
command execution while keeping the *decision* in chat. The voice PR
Implementer applied §13 carefully and surfaced the rule-vs-practice
gap rather than silently continuing it.
**Decision:** Update CLAUDE.md §1 step 8 to define merge execution as
Director-or-authorized-Implementer (UI button, personal terminal, or
chat-authorized Implementer paste). Add a tag-cutting clarifier
explaining that Architect "cuts the tag" by writing the annotation
text, and Director (or authorized Implementer) executes the
`git tag` + `git push origin <tag>` mechanics. Update §12's "Don't
ever" merge bullet so the violation is *unauthorized* execution rather
than execution itself; the absolute "Push to `main`" bullet stays
unchanged.
**Consequences:**
- Future Implementers reading CLAUDE.md cold no longer have to choose
  between rule-violation and workflow-friction.
- The "no unilateral Implementer merge" guarantee is preserved —
  Director chat-authorization remains mandatory, and Implementer never
  initiates a merge or tag push on its own initiative.
- The §13 "Director contradicts CLAUDE.md" protocol still applies for
  cases the text doesn't anticipate; this ADR closes the specific
  merge/tag case rather than rewriting §13.
**Alternatives considered:**
- *Stricter — Director must always execute merge + tag personally* —
  rejected as pure friction for no real safety gain. Director-
  authorization is already the gate; whether Director's hand or
  Implementer's hand types `gh pr merge` after authorization changes
  nothing about who decided.
- *Looser — Implementer auto-merges when CI green* — rejected as
  removing Director from the loop entirely, which is the whole point
  of the "Merge gate" role in §1. CI greenness is necessary, not
  sufficient.

---

## [2026-05-13] Voice tool dispatch routes through mesh for homeOS-data tools

**Status:** accepted
**Decided by:** Architect (approved by Director)
**Context:** Post-v0.1.0 (mesh awake, PR #10) and post-v0.2.0 (voice
running via daemon pattern, PR #9), the obvious next architectural unlock
was making voice a real mesh participant rather than a sibling-with-its-
own-tools. The follow-up was foreshadowed in the `Voice via daemon
pattern; mesh rebase deferred` ADR above. This ADR closes the loop.

raven's tool registry historically embedded each tool's implementation
as direct Python — `time_tool.py` reads `datetime.now()`, `memory_tool.py`
talks to a local JSON store. That works for raven-internal state but
doesn't generalise: any future tool that touches homeOS data (news
feeds, finance quotes, agent briefs) would either reimplement the
capability inside raven or call out to a different process via some
bespoke transport. The mesh exists precisely so we don't reimplement
or invent transports per tool.

**Decision:** raven becomes a mesh node `raven`, outbound-only. Tools
split into two categories by data-locality:
- **raven-internal** (time, memory) stay direct Python. Not homeOS
  data; not worth a mesh hop.
- **homeOS data or capabilities** (notify in this PR, news/finance/
  agents in future PRs) route through `mesh_client.mesh_invoke`. The
  tool function is a thin wrapper that calls into the mesh; the
  capability lives on its dedicated mesh node.

Implementation:
- `manifest.yaml` gains a `raven` node (identity-only, `surfaces: []`)
  and an edge `raven → host_notifications.notify`.
- `raven-core/raven_core/mesh_client.py` instantiates the vendored
  Python `MeshNode` (from `core/node_sdk/`, prepended to PYTHONPATH at
  spawn time by the shell's daemon manager — not pip-installed because
  the vendored tree is managed by re-copy from `_ingest`). Setup runs
  at orchestrator startup before the Gemini Live session opens; teardown
  in the orchestrator's finally block.
- `raven-core/raven_core/tools/__init__.py`'s `handle_function_call`
  becomes async to support `await mesh_invoke(...)` in tool handlers
  on the orchestrator's running event loop. Sync tools (time, memory)
  are detected and called without await; async tools (notify) expose
  `handle_call_async` and are awaited. This avoids the
  `run_until_complete`-on-a-running-loop deadlock that a sync wrapper
  would hit.
- The shell generates `MESH_RAVEN_SECRET` per cold start alongside the
  existing `MESH_*` secrets and injects it into Core (so the manifest's
  `env:MESH_RAVEN_SECRET` resolves) and into the raven daemon's spawn
  env. Raven daemon spawn now waits for mesh-ready (max 30s) before
  starting Python so the secret/URL are guaranteed available.

**Consequences:**
- Every future voice tool that touches homeOS data lands as a single
  mesh-edge declaration + a thin `await mesh_invoke(target, payload)`
  wrapper. Tool additions don't require changes to raven internals or
  the audio loop.
- Capabilities get reused across surfaces: `host_notifications.notify`
  is now invoked from both the Mesh Dev Tools app's button and from
  voice. Adding a third caller (e.g. an agent) is a manifest edge,
  not a code change.
- `core/node_sdk/__init__.py` stays vendored unchanged — no
  pyproject.toml, no setup.py. Python finds the module via PYTHONPATH
  injection at spawn time. This preserves the upstream re-copy story
  documented in `core/README.md`.
- **PYTHONPATH injection is now the canonical pattern for Python
  mesh consumers in homeOS.** Any future Python node or daemon that
  wants to import the vendored SDK should follow the same approach:
  resolve the SDK path in its spawn-side manager (shell-owned
  Electron service or equivalent), prepend to `env.PYTHONPATH` at
  spawn, and lazy-import `node_sdk` inside a `setup()` that runs
  before the consumer needs to invoke. The CLAUDE.md §14 third-
  instance rule still applies — if a third Python mesh consumer
  appears and we find ourselves duplicating the PYTHONPATH-prepend
  block, extract it then (and only then) into a shared spawn helper.
  Until that point, two implementations is not enough signal to
  abstract.
- raven daemon spawn now hard-fails (`voice: mesh not ready`) when
  mesh isn't ready within 30s. Acceptable: mesh-routed voice tools
  are useless without mesh, and raven's pip-install bootstrap usually
  takes longer than mesh's startup anyway.
- `requirements.txt` gains `aiohttp` (the Python SDK's HTTP client).
  Bootstrap marker filename bumped from `.requirements-installed` to
  `.requirements-installed-v2` so existing dev venvs re-run pip and
  pick up the new dep without a manual `rm -rf .venv`.

**Alternatives considered:**
- *Mesh-ify time and memory too.* Rejected as over-engineering. These
  are raven-internal state with no callers outside the voice daemon;
  routing them through the mesh adds two network hops to a 1ms
  operation and gains nothing.
- *Expose a generic `mesh_invoke(target, payload)` tool to Gemini.*
  Rejected — blast radius too wide. Gemini could be cajoled into
  calling arbitrary mesh surfaces; we want each voice tool curated,
  with explicit edges in the manifest.
- *Wait for `news_feeds` to land before doing the rebase.* Rejected.
  Demonstrate the pattern with the simplest existing node
  (`host_notifications`) so the architecture is proven and the pattern
  is locked in before more nodes layer on top.
- *Add `core/node_sdk/pyproject.toml` and `pip install -e core/node_sdk`
  in the raven bootstrap.* Tempting (cleaner imports, no PYTHONPATH
  manipulation) but rejected: `core/{core,node_sdk,schemas}` is
  managed by re-copy from `_ingest/RAVEN_MESH`, and a stray
  `pyproject.toml` would either be lost on the next vendor bump or
  force us to upstream it. PYTHONPATH stays inside the homeOS layer.

---

## [2026-05-13] First real data node: news_feeds

**Status:** accepted
**Decided by:** Architect (approved by Director)
**Context:** Post-v0.1.0 (spine alive), v0.2.0 (voice on the mesh), and
v0.2.1 (raven becomes a mesh node with the notify edge), every PR until
now has been infrastructure or substrate. The News app has been showing
the same three hardcoded faked articles for several PRs running.
`host_notifications` proved the mesh as an *action* substrate; the
obvious next step is proving it as a *data* substrate. News is the
natural first instance — well-understood data shape (RSS/Atom),
many stable public sources, valuable for the user, and one of the few
demos that justifies multi-consumer testing without contrivance (the
News app on the canvas + a `news_recent` voice tool both invoking the
same surface). Storage is required (polling 15-minute feeds means an
in-memory cache loses everything on shell quit), and SQLite via
`better-sqlite3` is the obvious choice — Pulse uses sqlite throughout,
the schema is one table, and the dependency is well-trodden in Electron
land.
**Decision:** Introduce `nodes/news_feeds/`, a Node.js mesh node that
polls a hardcoded list of feeds every 15 minutes, dedupes by stable id
(sha1 of `feed::guid` truncated to 16 hex), and exposes a single
`recent` surface (input: `{ limit?, since? }`; output: `{ articles }`).
Storage at `$HOMEOS_DATA_DIR/news_feeds/news.db` via better-sqlite3 in
WAL mode. Two edges in the manifest: `shell → news_feeds.recent` (News
app) and `raven → news_feeds.recent` (voice tool). The News app drops
its hardcoded `articles.ts` entirely and consumes the mesh surface.
**Consequences:**
- **Pattern established for every future data node.** Finance, calendar,
  sensors, agents — same shape: a single Node.js process per domain,
  one or more typed surfaces, SQLite under `$HOMEOS_DATA_DIR/<node>/`,
  manifest declares JSON Schema for input. CLAUDE.md §14 third-instance
  rule applies — when the third data node lands we'll know whether to
  extract a shared "data-node template" or keep them per-domain.
- **First multi-consumer mesh surface.** `news_feeds.recent` is invoked
  by both the shell (renderer-side React app) and raven (voice tool).
  Same surface, two callers — the manifest's edge graph is now doing
  load-bearing authorization work, not just point-to-point glue.
- **`better-sqlite3` is the first heavy native dep in `nodes/`.** Adds
  a build step (node-gyp / prebuilt binary fetch on first install) and
  ties the node to an ABI-matched Node.js. Acceptable: sqlite is a
  homeOS-wide need (Pulse uses it for everything), getting the
  dependency in early is better than discovering its quirks under
  pressure later. Flagged in the PR per CLAUDE.md §10 "Build & dependency
  hygiene."
- **`HOMEOS_DATA_DIR` env var is the canonical way nodes get a writable
  root.** Standalone Node child processes can't reach Electron's
  `app.getPath('userData')` themselves. The shell hands them
  `<userData>/data` via env at spawn time; nodes namespace under it
  (`news_feeds/news.db`, future `finance/quotes.db`, etc.). Same shape
  as `MESH_CORE_URL` and the per-node secrets — config flows out via
  env, never via a config file the node has to find.
- **OPML / user-editable subscriptions deferred.** v1 hardcodes 4 feeds
  in `src/feeds.ts`. Editing the list means edit-rebuild-restart. The
  goal of this PR is to prove the data substrate end-to-end, not solve
  subscription management. A follow-up PR will add either an OPML
  import path or a Settings app that writes a JSON config the node
  watches for changes.
- **No deduplication across feeds.** Two feeds reporting the same story
  (HN linking a Verge article, BBC + Reuters covering the same event)
  will appear as two articles. Stable-id dedupe is per-feed, not global.
  Acceptable for v1; global dedup is a future "near-duplicate detection"
  pass, not a blocker.
- **The news app now hard-depends on the mesh.** If `mesh.invoke` fails,
  the app shows an error state with a Retry button. This is the first
  app in homeOS where mesh failure is user-visible — Welcome and
  Markdown work without the mesh entirely. Acceptable: news without
  data is a useless screen anyway, and the error state explains why.

**Alternatives considered:**
- *Keep the hardcoded articles for one more cycle and ship the news_feeds
  node without changing the News app.* Rejected — the news_feeds node
  with no in-shell consumer is half the value, and the multi-consumer
  test (renderer + voice on the same surface) is the architecturally
  interesting thing this PR proves.
- *Use a flat-file JSON store instead of SQLite.* Rejected. Easy at 100
  articles, breaks down at 10k+, and the pattern wouldn't transfer to
  finance / sensors / agents where time-series queries are central.
  Better to take the native-dep hit now once than re-do storage in three
  follow-up PRs.
- *Put the polling loop inside the shell main process (no separate
  node).* Rejected. (a) Decoupling lets the mesh do its job — any
  consumer can invoke `news_feeds.recent` whether or not the shell is
  open. (b) Establishes the standalone-node pattern that finance /
  calendar / sensors will follow. (c) Polling failures in-process
  contaminate the shell's responsiveness; a separate node fails in
  isolation.
- *OPML / Settings-app for subscriptions in v1.* Rejected as scope creep.
  Pattern-first, configuration-second.
- *Use `axios`/`undici` and a custom RSS parser.* Rejected — `rss-parser`
  is well-maintained, handles both RSS and Atom, and the code we'd
  write to parse XML is the exact code we'd most like to avoid debugging.
- *Run the recent surface as `fire_and_forget` with a separate
  notification when articles update.* Rejected. The renderer wants
  fresh data on app open, not a push subscription; request/response
  is the simpler shape and matches how the user thinks about news.

---

## [2026-05-13] Feed categorization: hardcoded per-feed taxonomy

**Status:** accepted
**Decided by:** Architect (approved by Director)
**Context:** v0.3.0 shipped the news_feeds node with four feeds and a
single undifferentiated stream. Director's actual usage surfaced two
gaps within hours: not enough sources (four feeds = small daily
volume), and no way to ask the voice assistant for a specific *kind*
of news ("what's the latest tech news", "any local headlines"). Both
gaps could be solved together by widening the feed list and adding a
category dimension to the existing `news_feeds.recent` surface. The
mesh and voice transport already work — this is purely data + parameter
plumbing on top of the v0.3.0 substrate.

**Decision:** Hardcoded seven-category taxonomy declared in
`nodes/news_feeds/src/types.ts`: `world`, `us`, `tech`, `business`,
`sports`, `science`, `local`. Each feed in `feeds.ts` declares
*exactly one* category. Articles inherit their feed's category at
fetch time — no inference, no dynamic tagging, no per-article
overrides. The `news_feeds.recent` surface gains an optional
`category` parameter accepting either a single category string or a
1–7-element string array; JSON Schema enum-validates against the
seven known values, so unknown categories return a clean MeshDeny
from Core (not the node). The voice tool gains a matching `category`
parameter; the system prompt enumerates the seven values and includes
four few-shot examples for natural-language → category mapping. The
News app gains a chip row at the top — "All" plus the seven
categories, ordered identically to the type definition and the prompt
enumeration (broad → specific). Selecting a chip re-invokes
`news_feeds.recent` with the new category.

**Consequences:**
- Adding a feed = picking its category (one line in `feeds.ts`).
- Adding a new category = code change in `types.ts` + JSON Schema
  enum update + voice prompt update + UI chip auto-discovers from the
  list. Three places, all in this repo. Intentional friction — the
  category set shouldn't proliferate.
- A schema migration is required for installs that ran v0.3.0
  (`ALTER TABLE add column category`, plus a compound
  `(category, published_at DESC)` index). Existing rows get the
  'world' default at migration time; the next poll's UPSERT
  overwrites that with each row's actual feed category. One-time
  inaccuracy of ≤15 min.
- Bay Area is the de-facto "local" locale in v1 — KQED, SFGate Bay
  Area, Mercury News, SFist. User-configurable locale is deferred to
  a future PR that introduces a Settings surface.
- Multi-consumer parity holds: the same surface drives the News app
  *and* the voice tool. Adding a category dimension once propagates
  to both, which is the architecturally interesting test.

**Alternatives considered:**
- *ML / heuristic article-level categorization.* Rejected. Opaque to
  the user, slow to compute, and the false-positive rate on borderline
  stories (tech vs business; sports vs us) would be visibly bad.
  Per-feed categorization is editorial and deterministic.
- *Multi-category per feed.* Rejected. Hacker News *is* tech;
  TechCrunch *is* tech. Allowing N categories per feed complicates
  queries (set semantics, dedup) without solving a real ambiguity.
  Re-evaluate if a feed legitimately straddles two scopes.
- *User-configurable categories.* Rejected. No Settings app exists in
  v0.3.x. The category set is small enough that hardcoding for v1 is
  not the bottleneck; reconsider when Settings ships.
- *Free-text category.* Rejected. Defeats schema validation, fragments
  the taxonomy across installs, and Gemini will happily invent
  "celebrities" or "AI" as a category if not constrained.
- *Sports-team subcategory in this PR* (e.g. "Lakers news"). Deferred.
  Likely requires team-specific feeds or an external search surface;
  separate design problem.
- *Single category string only, no array.* Rejected at the schema
  level — the array shape costs almost nothing now (`oneOf` in the
  JSON Schema, dynamic IN-clause in storage) and unlocks `["us",
  "world"]` queries that future UI work might want without another
  schema migration.

---

## [2026-05-13] Second data node: finance via Finnhub

**Status:** accepted
**Decided by:** Architect (approved by Director)
**Note:** This ADR was originally drafted with Alpha Vantage as the
upstream. PR-#17 review surfaced that the AV free tier is now 25
req/day (was 5/min historically) — incompatible with this design's
~2880 req/day. Architect resolved on the PR: swap to Finnhub. The ADR
was edited in place before merge (the AV version never shipped to
`main`); the swap reasoning is preserved in Alternatives below.
**Context:** Post `v0.3.0`, finance is the natural second data node. News
(`news_feeds`) validates the RSS / bulk-recent pattern. Finance validates a
different shape entirely — REST API with an env-var key, per-symbol query
surface, numeric (not text) data, shorter freshness window, and a
provider-imposed rate limit that has to be respected without falling over.
Together, the two nodes earn signal on what is *shared template* (the
`nodes/<name>/{src,schemas,README.md}` layout, MeshNode + per-surface
handler shape, marker-file liveness, MeshDeny error taxonomy, voice-tool
mesh-routing pattern) versus *data-source-specific* (RSS-parser vs.
REST-with-headers, SQLite-with-WAL vs. in-memory cache, bulk-poll vs.
per-symbol-stagger, single-surface vs. two-surface ergonomics). Pattern
extraction is held back per CLAUDE.md §14's third-instance rule — two
nodes is signal, not yet enough.

**Decision:** Finnhub free tier as the data source (60 req/min, no daily
cap). Hardcoded ticker list of ten popular symbols (AAPL, MSFT, GOOGL,
AMZN, NVDA, TSLA, META, SPY, QQQ, DIA). In-memory cache with a 5-minute
freshness window — no SQLite. Two surfaces: `finance.quote({ symbol })`
for per-symbol queries (with `MeshDeny: finance_untracked_symbol` outside
the tracked list) and `finance.market_summary()` for the full cached
grid. 5-minute poll cycle with one symbol fetched every 30 seconds —
exactly five minutes total per cycle with ten tickers, so polling is
effectively continuous at ~2 req/min averaged (~3% of Finnhub's 60/min
budget). Rate-limit responses (HTTP 429) trigger a 60-second cooldown
during which on-demand `finance.quote` fetches return `MeshDeny:
finance_rate_limited` rather than retrying.

**Consequences:**
- Pattern documented for any future API-based data node (weather, sports,
  air quality, transit). The shape: REST client with structured-error
  enum, in-memory `Map`-based cache with freshness windows, stagger-aware
  poller, two surfaces (single-entity + collection-view).
- **No volume in v1.** Finnhub's `/quote` endpoint returns price, change,
  percent change, high/low/open/prev_close, and a timestamp — but no
  volume. Fetching volume would require a separate `/stock/metric` call
  per symbol, doubling request count for marginal user value. The
  trade-off chosen: drop volume from the QuoteCard display in v1, re-add
  if there's a clear use case (e.g. a "movers" view that ranks by
  unusual volume). The Quote type, JSON schema, voice tool response,
  and renderer all agree on the new shape (no `volume` field) — no
  half-state where one consumer knows the field and another doesn't.
- The renderer and voice tool both special-case `finance_rate_limited`.
  Renderer shows an amber "temporarily throttled — quotes refreshing
  later" card (distinct from the red "Finance unavailable" generic
  error). Voice tool returns `{error: "rate_limited", spoken: "Stock
  quotes are temporarily throttled, sir; try again in a minute."}`;
  Gemini reads the `spoken` field verbatim. Other errors collapse into
  the generic shape. Rationale: throttle is a temporary, expected state
  with a clear "retry later" remediation — collapsing into "unavailable"
  misleads the user.
- `MeshUnavailable` (Python, `raven_core/mesh_client.py`) gains an
  optional `reason` attribute so voice tools can branch on the MeshDeny
  reason without parsing the exception string. Cleaner than the parse-
  text alternative; the existing call-sites that just catch
  `MeshUnavailable` are unaffected (attribute is optional).
- User-configurable tickers and broader symbol coverage are future PRs,
  most naturally tied to a Settings app. The node-side change is a
  single file (`src/tickers.ts`); the JSON schema is unchanged.
- Voice tools (`finance_quote`, `finance_market_summary`) add a second
  category of mesh-routed tool. The anti-hallucination guardrail
  established for `news_recent` (training-data-is-stale) is reused
  verbatim for prices — arguably stronger here, since training-era
  stock prices look real and the user will catch wrong numbers
  instantly.

**Alternatives considered:**
- *Alpha Vantage free tier (5 req/min historically, 25 req/day current).*
  Rejected. The current free-tier daily quota (25 req/day) cannot
  support the design's 5-minute × 10-ticker poll cadence (~2880 req/day,
  well over quota). The PR-author originally implemented against AV per
  the spec; Architect resolved the cap mismatch by swapping to Finnhub
  before merge. Alpha Vantage remains a viable upstream if the design
  ever shifts to "fetch one ticker every six hours" / "fetch on user
  request only" — but that's a different shape from the one this ADR
  ratifies.
- *Yahoo Finance unofficial scrape.* Rejected — fragile and unsupported.
  The library would break on a quiet HTML change with no warning.
- *Paid-tier IEX Cloud / Polygon.* Rejected — premature for v1.
- *Fetch volume via `/stock/metric` per symbol.* Rejected for v1.
  Doubles request volume against the rate limit. Re-add when a use case
  earns it.
- *SQLite persistence (matching news_feeds).* Rejected. Stock quotes
  are time-sensitive; persisting them across restarts surfaces stale
  prices to consumers with no way to know they're stale. A cold start
  re-polls and shows the empty state until the first cycle lands —
  cheaper, less misleading.
- *User-configurable tickers in v1.* Deferred. Pattern-first,
  configuration-second (same call as news feeds).
- *Single surface (only `market_summary`, with the renderer filtering
  by symbol).* Rejected. The per-symbol surface is what makes the
  rate-limit boundary enforceable — without it, voice tools would
  have to fetch the full grid every time the user says "what's AAPL
  at", and there'd be no place to deny untracked symbols.
- *Hit the upstream API on every renderer refresh.* Rejected. 60-second
  renderer polling × multiple consumers would push toward the per-
  minute ceiling for no benefit; the cache insulates the upstream from
  consumer cadence.
- *Bundle a shared poller base class with news_feeds.* Rejected per
  CLAUDE.md §14 third-instance rule. Two nodes is too few to know which
  bits are shared template vs. coincidence. The third data node's PR
  (weather, probably) is the right time to extract.
- *Build a separate Settings surface as part of this PR for tickers.*
  Rejected as scope creep — the Settings app is its own PR.
