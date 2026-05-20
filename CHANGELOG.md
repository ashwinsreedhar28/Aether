# Changelog

All n### Fixed\n- **Calendar node hotfix.** PR #51 (calendar mesh node) shipped with
  four bugs discovered during smoke test: (a) `requirements.txt`
  pinned `pyobjc-framework-EventKit==10.3.1` and `pyobjc-framework-Cocoa==10.3.1`
  with no Python 3.14 wheel, forcing failing source build; loosened to
  `>=10.0` and added missing `aiohttp>=3.9.0` (transitive dep of
  `core/node_sdk`). (b) `main.py` used `MeshNode(surfaces={...})`
  constructor kwarg that doesn't exist; corrected to `node.on(name, handler)`
  registration after construction. (c) `main.py` lacked a keep-alive
  loop after `node.start()`, causing immediate daemon exit; added
  `while True: await asyncio.sleep(1)`. (d) `main.py` called
  `store.authorizationStatusForEntityType_(...)` on an EKEventStore
  instance, but it's a class method (`+` prefix in Obj-C headers);
  corrected to `EKEventStore.authorizationStatusForEntityType_(...)`.
  `docs/new-node-pattern.md` gets a Corrections section pending full
  refresh.
otable changes to Aether (working name homeOS through v0.3.x) are
documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning per
CLAUDE.md §6 (honest pre-1.0 scheme). Entries dated before the rename PR
refer to the project by its working name; they are preserved verbatim as
historical record.

## [Unreleased]

### Added
- `system_info.processes` surface — running-process snapshot via `ps -axo pid,comm,%cpu,%mem,etime`. Accepts `{ limit?: 1-200 (default 50), sort_by?: 'cpu' | 'memory' | 'pid' (default 'cpu') }`; returns `{ available, processes: [{ pid, command, cpu_pct, mem_pct, elapsed }], total_count }`. 5s in-memory cache shared across (limit, sort_by) inputs; `MeshDeny('invalid_argument', ...)` on out-of-bound limits or unknown sort keys. No new shell hooks (node already registered). Closes #83.
- `time` mesh node — stateless timezone-aware clock. One surface
  (`time.now`) returns the current wall-clock time in a requested IANA
  zone via `Intl.DateTimeFormat`. Params: `{ zone?: string, format?: 'iso' |
  'human' }`; returns `{ time, zone, unix_ms }`. Invalid IANA zones
  return `MeshDeny('time_bad_zone')` (detected by catching `RangeError`
  on `Intl.DateTimeFormat` construction). No SQLite, no poller — just
  `Date.now()` and the standard `running` marker under
  `$AETHER_DATA_DIR/time/`. TypeScript node spawned by `nodeManager`;
  raven edge added so a future voice-tool rewire can fold the existing
  local-only time tool into the mesh (rewire is a follow-up, not this
  lane). Closes #82.
- `docs/sprint-4-retrospective.md` — closing retrospective for Sprint 4 (v0.5.0 → v0.9.0; 13 PRs across three waves). Captures Wave 1 process work (#64–#67), #69 process discipline codification, Wave 2 data breadth + AppleScript bridge primitive (#73–#75), Wave 3 governance + features (#77, #80, #81, #84, #85). Banks 14 lessons in `docs/governance-log.md`. Introduces Sprint 5+ direction shift (mesh viz + cross-surface agent creation). Closes #86.
- macOS `macos_mail` daemon node + `@aether/macos-applescript` bridge primitive — Mail.app inbox mirror polling via AppleScript at 60s cadence. The bridge (`core/macos_applescript/`) exposes a discriminated-result `runAppleScript` API with TCC permission-denied detection (both `(-1743)` and `not authorized` forms), timeout via SIGTERM, and syntax/unknown error classification; intended for reuse by future Reminders/Notes/Calendar.app daemons. Mail node parses tab-separated AppleScript output, dedupes by message UID via INSERT OR IGNORE, persists to per-node SQLite at `$AETHER_DATA_DIR/macos_mail/mail.db`. Requires Mail.app Automation permission; debounced log on denial (logs once, then silent until granted). Exposes `macos_mail.recent` mesh surface. Closes #70.
- macOS `macos_messages` daemon node — reads `~/Library/Messages/chat.db` read-only every 30s (better-sqlite3 `{ readonly: true, fileMustExist: true }` + `PRAGMA busy_timeout = 5000`), per-chat watermark on `date_delivered` (Mac Absolute Time), composite `UNIQUE(chat_id, message_id)` dedup via INSERT OR IGNORE, cold-start arming seeds watermarks on the first tick. Per-node SQLite at `$AETHER_DATA_DIR/macos_messages/messages.db`. Requires Full Disk Access; EACCES is logged once and returns empty gracefully (daemon stays up). Exposes `macos_messages.recent` mesh surface. Closes #71.
- macOS `clipboard_history` daemon node — polls clipboard at 500ms via pbpaste, SHA-256 content-hash dedup, per-node SQLite with `CREATE TABLE IF NOT EXISTS`, exposes `clipboard_history.recent` mesh surface. Closes #72.
- Aether macOS app icon. Replaces the default Electron icon in Dock, Activity Monitor, Finder, and Cmd-Tab. Source assets in `docs/branding/`.

### Changed
- CI pre-build step replaced with workspace-wide `pnpm -r build`; the
  hardcoded per-package `pnpm --filter` chain in `.github/workflows/ci.yml`
  is gone, as is the now-redundant terminal `shell — build` step (covered
  by `pnpm -r build` running in topological order). `shell/package.json`'s
  `predev` and `prebuild` scripts likewise drop their hardcoded
  five-package list in favor of `pnpm -r --filter "!aether-shell" build`,
  auto-discovering shell's workspace dependencies. Enacts the 2026-05-20
  ADR (Proposed → Accepted) that PR #75 and PR #85 both validated.
- CHOKE FILE relief — split `DECISIONS.md` and `CHANGELOG.md` into
  archive files. Decisions dated 2026-05-13 and earlier moved to
  `docs/archive/decisions-pre-2026-05-14.md` (yielded ~455-line
  top-of-tree `DECISIONS.md`, down from 2269). `[Unreleased]` entries
  pre-Sprint-4 moved to
  `docs/archive/changelog-unreleased-pre-sprint-4.md` (yielded
  ~125-line top-of-tree `CHANGELOG.md`, down from 1051). `CLAUDE.md`
  §13.3 updated to remove both files from the CHOKE list with a
  regrowth-threshold note. Closes #78.
- README updated to reflect current state (v0.9.0). Adds version bullets
  for Sprints 2 through 4 (voice extensibility v0.6.0, substrate
  consolidation v0.7.0–v0.8.0, data breadth + process discipline v0.9.0).
  Architecture section updated to include the new `core/macos_applescript/`
  bridge primitive and three new macOS daemon nodes. Closes #79.
- Sprint 4 governance batch 4 — codifies ~10 lessons from Wave 2 (#73,
  #74, #75). CLAUDE.md §13.3 CHOKE FILES list expanded (manifest.yaml,
  docs/new-node-pattern.md, coreManager.ts, ci.yml). New §13.8 (Architect
  pre-flight checklist) and §13.9 (Manual completion fallback). New
  `docs/manual-completion.md` documents the proven Director-Architect
  paste-and-write fallback used three times in Sprint 4. Skill files
  updated: verify-build now runs `pnpm -r typecheck` and asserts
  lockfile cleanliness; ship-it asserts `pnpm install` precedes
  `git add -A`. New ADR (proposed) for `pnpm -r build` before typecheck
  to auto-discover SDK-shape workspace packages. Closes #76.
- **Sprint 4 process discipline codified.** New `CLAUDE.md` §13 sets the operations contract for Implementer prompts (lane-type tagging, mandatory pre-flight reads, large-file caution, pre-staging policy, verify-then-ship sequencing). Adds canonical prompt template, three subagents (`aether-implementer` on Opus, `aether-explorer` on Haiku, `aether-reviewer` on Sonnet), two skills (`verify-build`, `ship-it`), GitHub Issue + PR templates, and a new ADR. Docs-only — no source-code changes.
- Splash window now gates dismissal on backend readiness (mesh + voice + renderer) instead of renderer-mount alone, with a 1.8s minimum-display floor and a 15s hard cap. Existing `splash.html` gains a dynamic status line + thin progress bar driven by a new `splashPreload.ts` IPC channel (`splash:phase` → `window.aetherSplash.onPhase`). Replaces the previous flow where the main window appeared before mesh and voice were ready, leaving the user staring at empty surfaces for 5–30 seconds on cold start. Vision, calendar, and reminders intentionally NOT phases — they degrade gracefully and their cold-start venv bootstraps would push splash duration beyond the 15s cap. Cache-hydration awareness (PR #65 tie-in) deferred to a follow-up until the finance node exposes a `hydratedFromCache` event.
- News urgency scoring: added `urgency_reason` field to Article shape so voice responses speak the *why* of urgency (e.g. `"breaking prefix + <1h fresh"`, `"wire source + war topic"`). Existing scorer weights audited and left unchanged — the four-component design from the 2026-05-13 ADR is sound; the gap was voice-speak-the-why, not weight tuning. Schema bumps to `user_version=5` with a v4→v5 migration adding the column. `.breaking` surface and `news_breaking` voice tool unchanged in shape; new field is additive.
- Finance node now persists its poll cache to disk (`~/Library/Application Support/Aether/data/finance/cache.json`), loading it on startup if < 6 hours old. Demos and cold-start queries no longer wait for the first poll cycle to complete. Background polling unchanged. Atomic writes via tmp+rename prevent corruption on SIGKILL.
- Operations: §10 governance entries extracted from CLAUDE.md to `docs/governance-log.md`. CLAUDE.md drops from 49,239 to 26,256 chars (45% reduction), well under Claude Code's 40k performance threshold. New governance batches now append to `docs/governance-log.md`. Implementer sessions read a smaller CLAUDE.md as their first action — meaningful context-window and token savings per session.
- Voice tool registry now auto-discovers tool modules in `daemons/raven-core/raven_core/tools/`. Modules with `get_tools()` and `handle_call_async()` exports are loaded automatically; `__init__.py` no longer needs manual edits per new tool. Adding a new voice tool is now a single-file change.

### Fixed
- **Voice tools for reminders + system_info nodes** now register with
  Gemini. Both files previously held simple async functions returning
  strings — they imported a non-existent `raven_core.mesh` module and
  lacked the `types.FunctionDeclaration` / `types.Tool` / `get_tools()` /
  `handle_call_async()` pattern that `calendar_tool.py` and
  `finance_tool.py` use. Rewritten to match the canonical pattern.
  Tool count goes 23 → 30 functions across 11 → 13 groups. All seven
  new voice tools (3 reminders + 4 system_info) now route through
  Gemini correctly with natural `spoken` field responses.

---

*Older [Unreleased] entries (Sprint 1 through Sprint 3) are archived
in [docs/archive/changelog-unreleased-pre-sprint-4.md](docs/archive/changelog-unreleased-pre-sprint-4.md).*

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
