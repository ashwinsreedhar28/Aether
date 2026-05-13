# Changelog

All notable changes to homeOS are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning per
CLAUDE.md §6 (honest pre-1.0 scheme).

## [Unreleased]

### Added

- **The spine is alive.** RAVEN_MESH Core vendored to `core/` from
  `_ingest/RAVEN_MESH` at SHA `464ee809…`; TypeScript SDK ported to
  `core/node_sdk_ts/` (~370 LOC across canonical.ts, types.ts,
  MeshNode.ts, index.ts — vs. 310 LOC in `node_sdk/__init__.py` plus
  the explicit TS type declarations that Python doesn't need). Implements
  canonical JSON (Python `ensure_ascii=True`-compatible), HMAC-SHA256
  signing, envelope build, and a hand-rolled SSE consumer for
  /v0/{register,invoke,respond,stream}. Wire format proven HMAC-byte-
  identical to the Python SDK by an in-process round-trip vitest that
  spawns Core and exercises a real invoke / respond loop.
- Daemon-manager pattern (adapted from
  `_ingest/VIEWER/apps/viewer/electron/main/services/daemonManager.ts`)
  spawns the Python Core in parallel with the splash → reveal
  sequence. PID file, /v0/healthz polling to 30s timeout, error
  dialog (without quitting) on health failure, clean SIGTERM on
  `before-quit` with SIGKILL fallback after 5s plus a second wait
  so the parent doesn't exit mid-reap. Sibling `nodeManager` spawns
  Node.js mesh nodes the same way. python3 is resolved to an
  absolute path at boot (login-shell `command -v python3` → known
  macOS install paths → `$MESH_PYTHON` override) so GUI-launched
  Electron with its stripped PATH still finds a Python with our
  deps installed.
- `manifest.yaml` at repo root declares three nodes — `shell`,
  `host_notifications`, plus the implicit reserved `core` — and one
  edge: `shell → host_notifications.notify`. Identity secrets are env-
  var references; the shell generates fresh hex-32 values per cold
  start and injects them into spawned children (no on-disk
  persistence).
- First real mesh node: `nodes/host_notifications/`. Fires native
  macOS notifications via `osascript` (`execFile`, not `exec` — the
  shell is kept out of the loop). Returns `MeshDeny` on non-darwin
  platforms; the Windows path is a follow-up PR.
- New `Mesh` app (`shell/src/apps/mesh-devtools/`, lucide `Cable`
  icon, nav order 90): "core: online / offline" status pill (polls
  the new `mesh:status` IPC every 2s) and a "Send notification via
  mesh" button that drives `host_notifications.notify` end-to-end
  and reports round-trip ms.
- `mesh:invoke` and `mesh:status` channels on `window.homeOS.mesh.*`
  in the preload bridge. The renderer never holds a signing secret;
  the main process owns the shell's `MeshNode` instance.
- `pnpm-workspace.yaml` at repo root makes `shell/`,
  `core/node_sdk_ts/`, and `nodes/*` siblings of a single pnpm
  workspace. `pnpm dev` and `pnpm build` from `shell/` now pre-build
  the SDK + host_notifications via a `predev`/`prebuild` hook.
- `.env.local.example` at repo root documents the env vars the
  substrate recognises (`MESH_PYTHON`, `MESH_CORE_URL`) — copy to
  `.env.local` (gitignored) and export from your shell rc to
  short-circuit the 50-200ms login-shell python3 lookup.
- Markdown app (`shell/src/apps/markdown/`, order: 70, icon: `FileText`):
  opens `.md` / `.markdown` files via native dialog, renders with
  `react-markdown` + `remark-gfm` + holographic-tinted styles. Bundled
  About page on first launch.
- `AppDefinition` gains optional `fileTypes: string[]` and
  `iconForFile?: (path) => string` for file-based apps. App registry
  gains `getAppsForFileType(ext)` helper for future file-route routing
  (no consumers wired yet).
- Preload gains `window.homeOS.files` surface (`openDialog`, `readText`
  with 1 MiB cap and home/userData/downloads/temp allowlist guard).
- GitHub Actions CI runs typecheck/lint/build on every PR. PR template
  auto-fills §7 self-review. Branch protection documented in
  `docs/BRANCH_PROTECTION.md`.
- **First Jarvis-feeling interaction.** Voice assistant running via
  `daemons/raven-daemon` (Node.js HTTP+WS on `127.0.0.1:7433`,
  loopback-only) supervising `daemons/raven-core` (Python, Gemini
  Live API, two tools enabled: `time` and `memory`; vendored
  `cerebras_tool` / `silence_tool` / `system_tool` stay on disk but
  unregistered). Spawned on shell boot via
  `shell/electron/main/services/ravenDaemonManager.ts`; first-launch
  bootstrap (pnpm install + tsc for the daemon, python3 -m venv +
  pip install for the core) runs once on demand, off the splash
  critical path. PID file under Electron `userData/raven/`,
  /health probe, clean SIGTERM on `app.before-quit`. macOS-only this
  PR; non-darwin platforms surface "voice: macOS only in this build"
  via the Voice app pill.
- Voice control app (`shell/src/apps/voice-control/`, order: 80, icon
  `Mic`): status pill (green ready / amber listening / blue
  processing / red offline-or-error with reason), Start/Stop toggle,
  last 5 transcripts and last 5 tool calls. Subscribes to the daemon
  WS for live updates.
- Preload gains `window.homeOS.voice` surface (`availability`,
  `status`, `start`, `stop`, `recentTranscripts`, `recentToolCalls`,
  and four `on*` subscribe helpers). `GEMINI_API_KEY` env var
  required; absence degrades voice gracefully (voice offline, shell
  still works).

### Changed

- Workflow refactor: Architect↔Implementer reviews now ride on PR
  comments (Director relays one paste per round-trip, down from ~four).
  §11 First Task removed and replaced with an Architect Review
  Heuristics checklist self-applied before each PR. §7 self-review
  template gains a heuristics-check section.
- CLAUDE.md §1/§12 updated: Director-authorized Implementer execution
  of `gh pr merge` and tag push is now formally part of the workflow,
  codifying the pattern used in every prior merged PR. The "no
  unilateral Implementer merge" guarantee is preserved (chat-
  authorization is mandatory).

### Fixed

### Removed

## [0.0.3] - 2026-05-12

### Added

- App-discovery system (`import.meta.glob` of `src/apps/*`,
  `AppDefinition` shape adopted from VIEWER). Drop a folder into
  `src/apps/<name>/` with an `index.ts` exporting an `AppDefinition`
  and it auto-registers. (Apps declare an optional `order: number`
  for nav placement; default 100.)
- First content app: `news` with three hardcoded faked articles
  (Jarvis-feeling categories spanning finance/tech/sports, urgency
  and category styling via holographic theme). Faked data — no
  polling, no mesh, no real source yet.
- Welcome window refactored into the `welcome` app, discovered the
  same way as every other app.

### Changed

### Fixed

- Top nav no longer clashes with macOS traffic-light buttons under
  `titleBarStyle: 'hiddenInset'`; nav now respects an 80px left
  inset on macOS and exposes the empty strip as a drag region.

### Removed

## [0.0.2] - 2026-05-12

### Added

### Changed

- Converted `_ingest/{Pulse, RAVEN_MESH, NEXUS, VIEWER}` from gitignored
  clones to git submodules pinned to specific SHAs (see DECISIONS.md).

### Fixed

- Removed leftover `_ingest/` entry from `.gitignore` that PR #2 intended
  to delete but never staged (PR #3, no functional change — gitlinks
  override ignore rules).

### Removed

## [0.0.1] - 2026-05-12

### Added

- Electron shell skeleton (`shell/`) with `electron-vite`, React 19,
  Tailwind 4, TypeScript strict. `pnpm dev` boots a single holographic
  welcome window via splash → renderer-ready → reveal sequence (pattern
  lifted from Pulse's main/index.ts; theme values from VIEWER).
- macOS tray icon with deterministic stdlib-only PNG generator
  (`scripts/gen-tray-icon.mjs`, adapted from Pulse). Clicking the tray
  opens/focuses the welcome window.
- Holographic theme as CSS variables under `shell/src/theme/holographic.css`.
- `DECISIONS.md` initialised with the three week-1 ADRs (top-down strategy,
  pnpm adopted, holographic theme adopted from VIEWER).
