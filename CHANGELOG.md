# Changelog

All notable changes to Aether (working name homeOS through v0.3.x) are
documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning per
CLAUDE.md §6 (honest pre-1.0 scheme). Entries dated before the rename PR
refer to the project by its working name; they are preserved verbatim as
historical record.

## [Unreleased]

### Added
- Instrument views — top bar + Lanes view v1. The cockpit gains a navigable
  top bar (Scene · Chats · Mesh · Lanes) above the always-present CLI. **Scene**
  is the unchanged ambient panel dashboard and stays the default home (kept
  mounted across switches so summoned panels survive a view change). **Lanes**
  renders a sidebar of git-worktree lanes (semantic order: main → active →
  recent, matching #130) with a detail pane (branch, state, activity, dirty
  count, last commit, PR) fed by `lanes.status`, polled ~10s while mounted with
  a manual refresh; it consumes the #133 enrichment (`last_commit_msg`, `pr`,
  `gh_available`) and renders "—" / a "PR data unavailable" note as the graceful
  fallback when a field is absent/null. A lanes-node-down state degrades
  gracefully. **Mesh** is a minimal stub showing live node/edge counts from
  `mesh_introspection.topology` with a mount point reserved for the full graph
  (next lane). **Chats** is a tasteful "soon" placeholder. Renderer-only; no
  changes to main, preload, daemons, nodes, or manifest. VoiceIndicator moved
  into the shared top bar (visible in every view).
- Lanes PR-state + commit-message enrichment — `nodes/lanes/` now reports two
  extra fields per lane for the upcoming Lanes view. `last_commit_msg` is the
  HEAD commit subject (`git log -1 --format=%s`), gathered in the existing 10s
  git tick via one combined `git log` call (no extra spawn); the main worktree
  gets it too. `pr` is `{ number, state, url }` resolved from
  `gh pr list --state all` so merged/closed PRs still surface — fetched on a
  **separate 60s cadence**, async (`execFile`) and cached, never on the git
  tick and never blocking the cached-status serve. `pr` is null for the main
  worktree, branches with no PR, and whenever gh is unavailable; a top-level
  `gh_available:false` then accompanies the payload. gh missing /
  unauthenticated / erroring degrades silently — no crash, no stall. Both
  fields may be absent/null; the Lanes view renders "—". Schema description
  and README updated; the `lanes.status` params schema is unchanged (the
  surface still takes no params).
- CLI text routing to raven — one brain. Typing in the dashboard CLI now
  routes to the live raven (Gemini) session exactly like speaking: same tools,
  same routing, same spoken reply. New `POST /text {text}` on the raven node
  daemon validates non-empty text and forwards it to the Python child as a JSON
  envelope over the child's existing **stdin** pipe (the conduit the daemon
  already used for the `q\n` shutdown sentinel — not a WebSocket; the task's WS
  framing was recon-corrected, see PR); 409 `{error:'no_session'}` when nothing
  is listening, 202 `{ok:true}` on accept (acceptance, not completion — the
  reply arrives as audio + the existing transcript/tool-call pushes).
  `orchestrator.send_text` injects the turn via google-genai
  `send_client_content(turn_complete=True)`. Shell adds `raven.sendText` +
  `voice:send-text` IPC + `voice.sendText` preload. The CLI's old post-a-panel
  behavior survives as the `/post <text>` slash-command; unknown slash-commands
  get an inline ✗, an accepted send a ✓. Typed input does **not** auto-start a
  session (deferred product decision): with ambient off, typing yields a
  graceful ✗ `no_session`. The CLI now echoes the conversation chat-style: it
  subscribes to the existing `voice.onTranscript` push and renders a scrolling
  log (typed line + raven's reply). To make raven's spoken reply visible as
  text, `output_audio_transcription` is enabled and teed onto the `raven`
  transcript channel (previously only user audio was transcribed). The
  orchestrator buffers any turn arriving during the spawn→ready gap and injects
  it once the server's `setup_complete` lands (a bounded buffer-until-ready
  guard for fast typists racing connect). The **verbal ready cue** deferred from
  #129 is **not shipped enabled**: the injection mechanism (buffer-until-ready)
  is in place and sound, but injecting a greeting *instruction* as a user turn
  on `setup_complete` interleaves with the user's first real turn — the greeting
  is disabled pending a redesign (orchestrator speaking natively on
  `setup_complete` rather than the shell flushing an instruction turn).
- Voice routing for the `lanes` visualization intent — raven's prompt
  (`daemons/raven-core/raven_core/prompts/prompts.json`) now maps spoken
  requests about lanes/agents ("show me my lanes", "what are my agents doing",
  "which lanes are active") to `visualize({ intent: 'lanes' })`, connecting the
  6.5 `visualize` tool to the `lanes` intent PR #130 added to the visualizer.
  `'mesh'` remains the topology intent. Prompt-only change: no new tool, no
  manifest edge (the visualizer reads `lanes.status` itself), no code. The
  ack-not-narrate guard applies to lanes exactly as to mesh — brief spoken
  acknowledgment, panel contents never read aloud.
- Lanes sensor + dashboard (Sprint 6.5b) — `nodes/lanes/`, a TypeScript
  **Sensor** that polls `git worktree list` for the shared repo every 10s and
  exposes which development lanes (worktrees) are active vs idle through one
  surface, `lanes.status`. Per worktree it reports name, branch, `is_main`,
  dirty-file count, last-commit time, and `last_activity_ms` =
  `max(last commit, mtime of each dirty file)`; a lane is `active` if that is
  within 5 minutes (window overridable via `LANES_ACTIVE_WINDOW_MS` for smoke
  tests), else `idle`. Cache-then-serve with a `stale` flag past 30s;
  `MeshDeny('repo_unreadable')` if git itself fails. Activity is a **file-mtime
  heuristic, not live CC-process detection** (documented limit; process
  detection is a future enhancement). On an **observed** `active → idle`
  transition (never on first sight of a lane) it fires
  `host_notifications.notify` (`"Lane idle: <branch>"`); notify failures are
  logged and swallowed. The visualizer gains a third intent, `lanes`: a
  `dashboard.lanes` backdrop panel seeded + refreshed in the existing ~5s loop
  (resilient — renders "lanes sensor unavailable" rather than disappearing when
  the sensor is down) and a `viz-lanes` summoned overlay. manifest: `lanes`
  node entry + edges `visualizer → lanes.status` and
  `lanes → host_notifications.notify` (a `raven → lanes.status` voice edge is a
  deferred follow-up). Shell spawn-wiring mirrors the visualizer (paths,
  secrets, nodeManager, coreManager `MESH_LANES_SECRET` Core-env injection).
- Sprint 6 retro — closes Sprint 6 (Phase 4). Banks seven Sprint 6 lessons in
  `docs/governance-log.md` (2026-06-03): the full-stack worktree operational
  notes (submodules/`.env.local`/deinit ordering/post-merge `pnpm install`), the
  `frame-src` CSP allowance for html panels, the merge-first/append-on-404 upsert
  idiom, `pkill -f` missing daemon-spawned processes, manual-completion as a
  routine lane shape, estimate undershoot on wiring-edit counts, and the voice
  front-door finding. Adds a "Sprint 6 — what just happened" retro section to
  `docs/agent-platform-roadmap.md`, marks Sprint 6 complete, promotes ambient
  voice to the immediate next lane and adds a graphical-mesh-viz + iframe-sandbox
  relaxation candidate lane, reframes Sprint 11 (Aether-Architect) as
  failure-driven, and notes the "living brain" context layer in the
  personalization arc. Adds the canonical full-stack worktree recipe to
  CLAUDE.md §13.12. The deferred 6.5 voice smoke is recorded as CLOSED
  (2026-06-03).
- Ambient listening v1 (ambient-voice-v1) — hot mic while the shell is open.
  The shell auto-starts raven's listening session the moment the daemon
  becomes reachable (no manual `POST /listen/start`), announces readiness once
  per session with a native Electron notification ("Aether — Listening, sir."),
  and surfaces a listening dot in the dashboard top strip. The ensure is
  idempotent and re-engages on both a node-daemon restart (availability
  transition) and a Python-child death (status transition), so the mic comes
  back hot after a crash without any manual step. Control plane only — no
  daemon code touched. Hard-off: launch with `AETHER_VOICE_AMBIENT=0` to skip
  auto-start entirely (the indicator then shows "voice off"). Defaults ON.
- Visualize voice tool (Sprint 6.5) — "show me the mesh" now summons the
  mesh-topology panel by voice. `daemons/raven-core/raven_core/tools/visualize_tool.py`
  is a thin tool that calls `mesh_invoke('visualizer.render', { intent: 'mesh' })`;
  the new `raven → visualizer.render` manifest edge (deferred from 6.4) authorises
  the hop. Auto-discovered by the tools registry like every other tool (no manual
  registration). raven's **first side-effect-with-ack tool**: unlike every other
  voice tool it returns a tiny success/failure signal rather than data to read
  aloud, and the prompt instructs raven to speak only a brief acknowledgment
  ("Showing you the mesh, sir.") — explicitly **not** to narrate the panel's nodes,
  edges, or counts. v1 wires intent `mesh` only into the voice path; the dashboard
  backdrop stays auto-seeded. `prompts.json` gains the 15th tool-list entry, a
  Visualizations instruction paragraph, success + failure examples, and a
  `function_descriptions` entry.
- Visualizer mesh node (Sprint 6.4) — `nodes/visualizer/`, a TypeScript
  **Mixer** that bridges the mesh (data layer) to the RAVEN_AVP scene server
  (presentation layer): the only mesh component that knows about both. It reads
  mesh state via `node.invoke('mesh_introspection.topology')` and POSTs composed
  SceneDoc panels over HTTP — "mesh in, HTTP out." One inbound surface,
  `visualizer.render({ intent, args? })`, intent-routed to template functions:
  `dashboard` composes the always-present `dashboard.*` backdrop
  (`dashboard.mesh-health`, `dashboard.raven-status`), seeded on boot and
  re-POSTed every ~5s to the merge endpoint so it stays live; `mesh` composes a
  summoned topology overlay (`viz-mesh`); unknown intents return
  `MeshDeny('unknown_intent')`. v1 panels are **script-free** (`text`/`markdown`
  only) to render under the shell's `sandbox=""` iframe — a graphical SVG mesh
  viz is a deferred fast-follow pending a sandbox-relaxation policy. All panels
  pass through `coerceStyle` so every `style` value is a string before POST
  (governance-log 2026-05-26). `SceneClient.upsertPanel` merges existing panel
  ids in place (append-on-404) so dashboard re-POSTs never 409, and is
  failure-tolerant: a down scene server logs and skips the cycle rather than
  crashing the node. Wired into the shell's node-spawn path (nodeManager +
  coreManager secret injection + paths + secrets); manifest gains the visualizer
  node entry plus the `visualizer → mesh_introspection.topology` and
  `shell → visualizer.render` edges (`raven → visualizer.render` deferred to the
  Sprint 6.5 voice wire-up).
- Dashboard UI (Sprint 6.3b) — the placeholder dashboard is replaced by a
  live scene dashboard. `Dashboard.tsx` subscribes to
  `window.aether.scene.onSceneEvent`, replacing the panel list on snapshots
  and reconciling deltas by panel id (add/update upsert, remove filter;
  entity changes skipped this lane). `PanelRenderer.tsx` renders panels by
  kind — `text` (preformatted), `markdown` (react-markdown + remark-gfm),
  `html` (maximally-sandboxed iframe); unknown kinds get a labeled fallback.
  `Cli.tsx` is a permanent Claude-Code-style bottom input strip that POSTs a
  text panel on Enter (Shift+Enter for newline), surfaces POST failures
  inline, and recalls history with the up/down arrows. The CLI-posted panel
  appears via the scene delta, proving the CLI → server → subscriber →
  dashboard round-trip. Second half of Sprint 6.3; the 6.3a transport probe
  is removed.
- Scene transport (Sprint 6.3a) — the shell now subscribes to the
  RAVEN_AVP scene server's WebSocket (`ws://127.0.0.1:5180/scene/stream`)
  from the main process via a new `sceneSubscriber` service, forwarding
  snapshots + deltas to the renderer over a `scene:event` IPC push.
  Renderer can POST panels via `window.aether.scene.postPanel()` (main
  proxies the HTTP call; the renderer never opens a socket). Reconnects
  with backoff on scene-server restart. First half of Sprint 6.3; a
  trivial renderer probe (console-logs events + a test-panel button)
  proves the transport end-to-end. The real Dashboard + PanelRenderer +
  CLI land in 6.3b.
- RAVEN_AVP scene server vendored as a git submodule at
  `daemons/raven-avp-server/` (upstream:
  R-A-V-E-N-delegate/RAVEN_AVP). The shell now supervises an
  external FastAPI daemon on port 5180 that holds visualization
  state (SceneDoc panels + entities) and broadcasts mutations over
  WebSocket. New `sceneServerDaemonManager` in
  `shell/electron/main/services/` follows the vision daemon-manager
  pattern simplified (no mesh registration — scene server is
  external infrastructure, not a mesh node). Scene state persists
  to `<userData>/data/raven-avp/scene_state.json` across restarts.
  No shell-side consumption yet: subscriber + CLI + real dashboard
  land in Sprint 6.3, visualizer mesh node lands in Sprint 6.4,
  voice integration lands in Sprint 6.5. First Sprint 6 lane that
  brings external code into Aether's tree.
- `mesh-viz` content app — radial visualization of the live mesh topology, with `core` at center (toggleable) and 16 user nodes branching radially by category (Sensor/Actor/Mixer/Planner color and symbol coded). Edges drawn from `mesh_introspection.topology`. Live activity feed sidebar consumes `mesh_introspection.activity`. Always-visible node labels; hover state highlights node and its edges. Foundation for lane 108b (click-to-inspect) and lane 108c (live edge pulse). Closes #108.
- Sprint 5 retrospective (`docs/sprint-5-retrospective.md`). Closes Sprint 5 (Phase 4). Banks 14+ lessons across process discipline, operational gotchas, and architectural decisions. Formalizes the substrate-stays-human-architected ADR in DECISIONS.md. Introduces the manifest `description` field convention (DECISIONS.md ADR + roadmap doc Sprint 6 lane). Expands CLAUDE.md §11 with two new heuristics (#10 pre-decide-load-bearing, #11 hand-written documentation lanes) and adds §13.10 / §13.11 (manual-completion kit expanded to five shapes, bundle-size reporting for deletion lanes). Adds sports + research as Sprint 6 sensor lanes in the roadmap doc. Closes Sprint 5.
- Manifest `description` field formalized in schema and threaded through broker `/__introspection__` payload to the `mesh_introspection.topology` surface. Schema at `core/schemas/manifest.json` gains typed `metadata.description` with 280-char max-length. Built-in `core` node gets its first description. All 16 user nodes already had descriptions in `manifest.yaml`; no backfill needed. Substrate-only — renderer-side consumers will land with the visualizer node in Sprint 6, after the direction shift archives the current mesh-viz content app. Originally scoped as 108d (mesh-viz hover); reduced mid-flight when the direction shifted from windowed content apps to dashboard + on-demand visualization.
- `mesh_introspection` mesh node — a TypeScript daemon that polls the broker's bearer-gated `/__introspection__` endpoint at 2s cadence and re-exposes the live mesh as two signed surfaces: `mesh_introspection.topology` (`{nodes, edges}`) and `mesh_introspection.activity` (newest-first invocation ring buffer). Cache-then-serve from memory — surfaces return the last-known-good snapshot with `stale: true` when the last successful fetch is >10s old, or `MeshDeny('broker_unreachable')` before the first success. Reads `ADMIN_TOKEN` from its shell-injected env to authenticate. Plus: manifest categorization for all nodes — every `manifest.yaml` node now carries a `category` (Sensor/Actor/Mixer/Planner per the roadmap vocabulary), and `core/schemas/manifest.json` requires it with that enum. Closes #107.
- Broker: in-memory invocation ring buffer + new `/__introspection__` endpoint exposing live topology + edges + recent activity. Foundation for the mesh-viz content app (sub-lanes 2 and 3). Read-only; HMAC-authed. Closes #106.
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
- Nav cleanup: removed `welcome` and `markdown` content apps (no longer in use); removed `mesh-devtools` debug app (superseded by mesh-viz from #113). Renamed `mesh-viz` display name from "Mesh Viz" to "Mesh" (single mesh observability surface now). Fixed Finance icon resolving to Sparkles fallback — `TrendingUp` was declared in `finance/index.ts` but never added to `App.tsx`'s ICON_MAP. Resulting nav: News, Finance, Voice, Mesh.
- Raven default voice swapped from `Aoede` to `Charon`. Charon is the
  closest match in Gemini Live's prebuilt voice set to an older British
  gentleman's voice (deeper register, measured cadence). User overrides
  via `~/.raven/config.json` `voice_name` still win — this change only
  affects the default.

### Removed
- Content-app paradigm archived. Four content apps (`news`, `finance`,
  `voice-control`, `mesh-viz`) moved to `_archive/shell-content-apps/`.
  Launcher infrastructure removed (`shell/src/lib/app-registry.ts`,
  `shell/src/lib/app-definition.ts`, `shell/src/stores/active-app.ts`).
  `shell/src/App.tsx` rewritten to render a placeholder dashboard
  component (`shell/src/dashboard/PlaceholderDashboard.tsx`).
  First Sprint 6 lane in the direction-shift sequence (Sprint 6.2
  vendors the RAVEN_AVP scene server; 6.3 stands up the real
  dashboard + CLI; 6.4 ships the visualizer mesh node; 6.5 wires
  voice integration). See `docs/agent-platform-roadmap.md` Sprint
  5.5 + Sprint 6 sections and the 3 ADRs banked in `DECISIONS.md`
  on 2026-05-26 for full direction-shift context.

### Fixed
- `macos_messages` self-sent iMessages now appear on
  `macos_messages.recent`. The canonical chat.db query watermarked and
  ordered on `message.date_delivered`, which is 0 for messages sent
  *from* this Mac (Apple populates the field only on inbound APNS
  delivery), so self-sent rows never crossed the watermark and never
  reached the surface. Switched to `MAX(m.date, m.date_delivered)` —
  SQLite's 2-arg scalar form, not the aggregate — as the effective
  timestamp in the WHERE filter, ORDER BY, SELECT (aliased
  `effective_time`), per-chat watermark advance, and cold-start seed.
  Aether-side `messages_recent.date_delivered` column now stores this
  effective value (semantic drift documented in `storage.ts`); column
  name preserved for consumer compatibility. No schema migration. Mesh
  surface contract unchanged. Closes #101.
- `macos_mail` AppleScript scoped to 20 most recent inbox messages.
  Previous enumeration of full inbox exceeded the 30s `runAppleScript`
  timeout on large mailboxes (repro: 97k messages). Bridge timeout
  unchanged. Output shape (5-field TSV) unchanged. Closes #100.
- Voice tools were not wired for the four new Sprint 4 mesh surfaces (`clipboard_history.recent`, `macos_messages.recent`, `macos_mail.recent`, `system_info.processes`). The substrate was alive (Sprint 4 smoke test confirmed all daemons running and surfaces responding via Mesh Dev Tools), but raven had no `FunctionDeclaration`s for any of them — voice queries returned "cannot access that" for every Sprint 4 surface. Five voice tools added/modified in `daemons/raven-core/raven_core/tools/` per the canonical pattern from PR #56:
  - `clipboard_tool.py` (new) — `clipboard_recent`
  - `messages_tool.py` (new) — `messages_recent`
  - `mail_tool.py` (new) — `mail_recent`
  - `system_info_tool.py` (modify) — adds `system_processes` alongside existing four
  - `time_tool.py` (modify) — rewires from local computation to `mesh.invoke('time.now', { zone })`, enacting the PR #85 TODO. Also switches `handle_call` to `handle_call_async` since `mesh_invoke` is async.
- **Voice tools for reminders + system_info nodes** now register with
  Gemini. Both files previously held simple async functions returning
  strings — they imported a non-existent `raven_core.mesh` module and
  lacked the `types.FunctionDeclaration` / `types.Tool` / `get_tools()` /
  `handle_call_async()` pattern that `calendar_tool.py` and
  `finance_tool.py` use. Rewritten to match the canonical pattern.
  Tool count goes 23 → 30 functions across 11 → 13 groups. All seven
  new voice tools (3 reminders + 4 system_info) now route through
  Gemini correctly with natural `spoken` field responses.
- Voice tool wiring follow-ups (v0.9.1 smoke test). Four defects landed in v0.9.1 that the smoke test surfaced (each caught only after fixing the previous):
  - `time_tool.py` sent `format: "12h"` to the `time.now` surface, but the daemon's schema enum is `["iso", "human"]` with `additionalProperties: false`. Schema validator rejected the call → raven fell back to local time silently, ignoring the requested zone. Fix: send `format: "human"` so the daemon returns a pre-formatted speakable string ("2:32 PM EDT"), parse the daemon's actual response shape `{ time, zone, unix_ms }` directly, drop the 12h/24h voice-side toggle (daemon controls formatting). Adds a `_friendly_zone()` helper so "Asia/Tokyo" renders as "Tokyo" in the spoken response.
  - `manifest.yaml` was missing the `raven → system_info.processes` edge. PR #84 added the substrate surface but not the raven edge (Sprint 4 wasn't voice-aware); the Sprint 4.5 voice-wiring lane didn't include manifest changes (a lane-spec gap). The `system_processes` voice tool routed correctly inside raven but mesh denied the invocation with `MeshUnavailable`. Fix: add the edge alongside the other `system_info` voice edges.
  - `system_info_tool.py` read wrong field names from the `system_info.processes` response: `name` (daemon emits `command`) and `memory_mb` (daemon emits `mem_pct`, which is a percentage, not megabytes). All process names came through as "unknown" and memory values rendered as zero. Caught only after fixing the manifest edge above (without the edge, the surface wasn't reachable at all). Fix: read `command` for the process name (with path-leaf extraction so `/sbin/launchd` → `launchd`), read `mem_pct` for memory percentage, update spoken format to "name at X.X% CPU/memory".
  - `system_info` daemon used `ps -axo pid,comm,...`, but macOS's `comm` keyword returns the **path** truncated to ~16 characters (it's not the kernel's short exec name like on Linux). So `/Applications/Arc.app/Contents/MacOS/Arc` showed as `/Applications/Ar`, `/usr/libexec/duetexpertd` as `/usr/libexec/due`, and the voice tool's path-leaf extraction (added in #96) produced fragments like "Ar", "due", "Applicat". Caught at v0.9.3 smoke test ("what's hogging my CPU" spoke fragments instead of names). Fix: switch daemon to `ps -axwwo pid,ucomm,...`. `ucomm` is the kernel's user command name — clean binary names like `WindowServer`, `fseventsd`, `coreaudiod`, `contactsd` with no path noise (still capped at ~15 chars on macOS, but real names not path fragments). Voice tool's path-leaf logic stays in place as a no-op safety net.

---

*Older [Unreleased] entries (Sprint 1 through Sprint 3) are archived
in [docs/archive/changelog-unreleased-pre-sprint-4.md](docs/archive/changelog-unreleased-pre-sprint-4.md).*



### Fixed
- **Calendar node hotfix.** PR #51 (calendar mesh node) shipped with
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

### Fixed
- `/__introspection__` payload forward-compat. Added `category: "uncategorized"` to node objects (consumer in #107 replaces with real categories from manifest categorization) and `allowed: true` to edge objects. Edge payload is per-surface — each row is `{from, to, surface, allowed}` rather than per-node-pair — adopted as the locked shape for #107 and #108. Closes the gap on #109's stated forward-compat (PR body §11.4 attested these fields as present; they were not).

### Fixed
- Broker reads `category` from `manifest.yaml` instead of hardcoding `"uncategorized"`. PR #110 added `category` to the `/__introspection__` response shape but emitted a hardcoded literal; PR #111 added real `Sensor`/`Actor`/`Mixer`/`Planner` values to the manifest but the broker was still hardcoding `"uncategorized"`. The loader now carries `category` through `state.nodes_decl` (defaulting to `"uncategorized"` if absent for backwards compat), and `handle_introspection` reads from it. The built-in `core` node is categorized as `Mixer` (it composes other surfaces during dispatch). Closes the last gap in the Sprint 5 Lane 1 broker contract.
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
