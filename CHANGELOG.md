# Changelog

All notable changes to homeOS are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning per
CLAUDE.md §6 (honest pre-1.0 scheme).

## [Unreleased]

### Added

- **Second real *data* node: `finance`.** Node.js mesh node at
  `nodes/finance/` that polls Finnhub's `/quote` endpoint every 5
  minutes for a hardcoded list of ten US tickers (AAPL, MSFT, GOOGL,
  AMZN, NVDA, TSLA, META, SPY, QQQ, DIA), staggering one symbol every
  30 seconds within each cycle (~2 req/min averaged, ~3% of Finnhub's
  60/min free-tier ceiling). Quotes cached in-memory (NOT SQLite —
  quotes are time-sensitive and persisting them across restarts would
  mislead consumers). Two surfaces: `finance.quote({ symbol })`
  returns the cached quote (refreshing on-demand if stale), with
  `MeshDeny: finance_untracked_symbol` for symbols outside the tracked
  list; `finance.market_summary()` returns the full cached grid.
  Validates the data-node template as a reusable pattern (news was
  the RSS shape; finance is the REST-API shape) — pattern extraction
  is held back to the third instance per CLAUDE.md §14. No volume in
  v1 (Finnhub's `/quote` doesn't return it; the `/stock/metric` side
  call wasn't worth doubling request volume for v1 — see DECISIONS.md).
- **New Finance app** at `shell/src/apps/finance/` (order 60, between
  News and Markdown; `TrendingUp` icon). 2-column-mobile / 3-column-
  desktop responsive grid of `QuoteCard`s — symbol, price, dollar +
  percent change with green ▲ / red ▼ direction arrows, latest-trading-
  day label. Auto-refresh every 60 seconds against
  `finance.market_summary`; most ticks hit the node's in-memory cache
  cheaply. Loading / empty / generic-error states match the holographic
  language established by the News app. A distinct amber "temporarily
  throttled — quotes refreshing later" state surfaces only on
  `finance_rate_limited` MeshDeny; all other errors collapse into the
  red "Finance unavailable" path.
- **Two new voice tools:** `finance_quote(symbol)` ("what's AAPL at",
  "how is Tesla doing today") and `finance_market_summary()` ("how's
  the market", "give me a market update", "my stocks"). Both routed
  through `mesh_invoke` to the finance node. On `finance_rate_limited`
  the tools return a structured `{error: "rate_limited", spoken: …}`
  response so Gemini reads "Stock quotes are temporarily throttled,
  sir; try again in a minute." verbatim rather than the generic
  unavailable copy. Prompt updates: ticker mapping (AAPL=Apple,
  MSFT=Microsoft, etc.) so Gemini doesn't have to guess; few-shot
  examples for both tools; the `spoken`-field-verbatim convention is
  documented in the system prompt; explicit anti-hallucination
  guardrail extending the news-tool pattern — training data contains
  historical stock prices that LOOK real but are months out of date,
  so the model is told never to quote a price from memory.
- **Four new manifest edges:** `shell → finance.market_summary`,
  `shell → finance.quote`, `raven → finance.market_summary`,
  `raven → finance.quote`. Same-surface multi-consumer pattern from
  `news_feeds.recent` carries forward.
- `MESH_FINANCE_SECRET` joins the per-launch secrets bag. The shell
  forwards a user-supplied `FINNHUB_API_KEY` env var into the spawned
  finance child (refusal-on-missing with a clear log message);
  `.env.local.example` documents the new var.
- `nodes/finance/schemas/{quote,market_summary}.json` — JSON Schemas
  validated by Core on every invocation. Same `MeshDeny` channel as
  news for rate-limit / unknown-symbol / malformed-response errors.
- `nodeManager` spawns the finance node alongside `host_notifications`
  and `news_feeds`; `staleSpawns` cleanup extended with a pattern
  match on `finance/dist/index.js`.

### Changed

- **`MeshUnavailable` (Python, `raven_core/mesh_client.py`) gains an
  optional `reason` attribute.** Set to the MeshDeny reason from the
  remote node when the failure path was a `kind=error` response;
  `None` for setup-time failures (env unset / SDK import failed /
  register failed). Lets voice tools branch on `e.reason ==
  "finance_rate_limited"` rather than parsing the exception string —
  the cleaner shape that every future mesh-routed tool will benefit
  from. Existing call sites that only `except MeshUnavailable` are
  unaffected.

- `README.md` at repo root: project description, current state,
  quickstart, architecture overview, governance model summary,
  project context. First public-facing documentation surface.
- `LICENSE` file at repo root (MIT).

- **First real *data* node: `news_feeds`.** Node.js mesh node at
  `nodes/news_feeds/` that polls a hardcoded list of RSS/Atom feeds
  (Hacker News, BBC, The Verge, Ars Technica) every 15 minutes,
  dedupes articles by stable id (sha1 of `feed::guid`), stores them
  in SQLite at `$HOMEOS_DATA_DIR/news_feeds/news.db` via
  `better-sqlite3` in WAL mode, and exposes a single `recent` surface
  (`{ limit?, since? } → { articles }`). First poll fires
  immediately on startup so launch-to-data is ~5s, not 15min.
- **First multi-consumer mesh surface.** Two edges in
  `manifest.yaml`: `shell → news_feeds.recent` (the News app drops
  its hardcoded `articles.ts` and consumes the mesh) and
  `raven → news_feeds.recent` (new voice tool). Same surface, two
  callers — the manifest's edge graph is doing real authorization
  work now, not just glue.
- News app refactor (`shell/src/apps/news/`): mesh-driven, with
  loading / empty / error states and a Retry button. Clicking an
  article opens its URL in the system browser via the new
  `window.homeOS.shell.openExternal` preload bridge (http/https
  scheme-checked in main).
- Voice tool `news_recent(limit?, category?)` in
  `raven_core/tools/news_tool.py`. Reads aloud headlines fetched
  through the mesh; strips id/url/fetched_at/published_at from the
  response so Gemini's output stays focused on the readable fields.
  Prompts updated with a few-shot example and a "do not invent
  headlines from prior knowledge" guardrail (same anti-hallucination
  shape that worked for the time tool).
- `MESH_NEWS_FEEDS_SECRET` joins the per-launch secrets bag.
  `HOMEOS_DATA_DIR` env var is the canonical path nodes use to
  reach a writable root (set by `nodeManager` at spawn to
  `<userData>/data`).
- `nodes/news_feeds/schemas/recent.json` — JSON Schema validated
  by Core on every invocation (limit clamped to `[1, 100]`, since
  must be ISO datetime). Both renderer + voice errors surface
  through the structured `MeshDeny` channel rather than as opaque
  exceptions.

- **Voice → mesh integration.** raven registers as the `raven` mesh
  node on orchestrator startup and routes its new `notify(title, body)`
  tool through `mesh.invoke('host_notifications.notify', ...)`. First
  time voice and mesh interact end-to-end. Pattern established for all
  future voice tools that need homeOS data or capabilities: declare in
  `raven_core/tools/`, implement as a thin `await mesh_invoke(...)`,
  add the edge in `manifest.yaml`. Internal tools (time, memory) stay
  direct Python.
- `manifest.yaml` grows the `raven` node (identity-only, no inbound
  surfaces) and the `raven → host_notifications.notify` edge.
- `raven-core/raven_core/mesh_client.py`: outbound-only mesh client
  for raven. Wraps the vendored Python SDK (from `core/node_sdk/`,
  reached via PYTHONPATH injection at spawn time — no pip install
  against the vendored tree). Setup at orchestrator startup; shutdown
  in the finally block.
- Tool registry (`raven_core/tools/__init__.py`) is now async-aware:
  modules expose either sync `handle_call` or async `handle_call_async`;
  the registry awaits the latter so mesh-routed tools can `await
  mesh_invoke` on the orchestrator's running event loop without a
  `run_until_complete`-on-a-running-loop deadlock.
- `MESH_RAVEN_SECRET` joined the per-launch secrets bag; injected into
  both Core (for manifest env-var resolution) and raven daemon spawn
  env. raven daemon now waits for mesh-ready (max 30s) before starting
  Python so the secret + `MESH_CORE_URL` are guaranteed available.

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

- raven daemon's pip-deps marker bumped from `.requirements-installed`
  to `.requirements-installed-v2`. Existing dev venvs from PR #9 will
  re-run `pip install -r requirements.txt` once on first launch after
  pulling this branch (picks up the new `aiohttp` dependency for the
  mesh SDK). Adds ~30s to first launch only.
- raven's system prompt + few-shot examples updated to teach Gemini
  Live about the `notify` tool (per PR #9's lesson that the
  audio-preview model needs explicit prompting to call tools
  reliably).
- raven tool registry (`raven_core/tools/__init__.py`) is now
  async-aware: existing sync tools (time, memory) are unchanged;
  async tools (notify) expose `handle_call_async` and are awaited by
  the registry. Orchestrator's `handle_function_call_async` now
  awaits the registry call.
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
- CLAUDE.md §10 expanded with four scars from PR #9 voice debugging:
  `spawnSync` UI-freeze in Electron main, macOS stripped-PATH in
  Electron, stdout-pollution breaking JSON-RPC daemons, mic-during-
  playback acoustic echo loop. Each scar names its source commit so
  future readers can audit the original failure.

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
