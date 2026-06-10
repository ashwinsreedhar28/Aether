> **HISTORICAL — 2026-06-10.** This is the briefing that drove the rebuild: it describes the four pre-absorption source repos under `_ingest/` as they were cloned, not the system Aether has since become. For the living architecture, read [docs/atlas/architecture.html](docs/atlas/architecture.html); for current operating law, [CLAUDE.md](CLAUDE.md).

# Aether — Master Synthesis

> Written under the working name **homeOS** through v0.3.x; references to "homeOS" inside this document have been retargeted to "Aether" by the rename PR. Filesystem paths like `~/Aether/` reflect the renamed project's intended layout (the actual workspace directory under Director's home is a separate rename decision Director may make later — GitHub auto-redirect keeps the existing repo URL alive in the meantime).

> **Purpose.** This document is a briefing for Claude Opus 4.7 — a downstream architect
> with no access to the source repos or this conversation. Read it cold and you should
> have enough to design the Aether / "realistic Jarvis" core: an always-on personal OS
> whose modules are data-ingestion engines (investing, news, research, sports, …) and
> whose surface is a desktop-class agentic workspace.
>
> **Scope of source material.** Four cloned repos under `_ingest/`:
>
> 1. **Pulse** (`_ingest/Pulse`) — Electron menu-bar app, IPC + polling + local data engine.
> 2. **RAVEN_MESH** (`_ingest/RAVEN_MESH`) — protocol-layer Python broker (nodes, surfaces, edges, audit).
> 3. **NEXUS** (`_ingest/NEXUS`) — agent orchestration: Docker-cell agents, queues, teams, mailbox, MCP.
> 4. **VIEWER** (`_ingest/VIEWER`) — Electron+React modular desktop workspace, command palette, agent + voice daemons.
>
> Everything below is grounded in the actual code in those repos as of the clone above.

---

## 0. Mission in one paragraph

The user wants a local, private, always-on personal OS — "Jarvis from Iron Man, but
realistic." Replace armor/weapons with *tools*: investing, research, news, sports,
voice, you name it. The four repos already contain the load-bearing patterns to build
this; the synthesis task is to merge **Pulse's data engine** (polling, scoring,
SQLite-backed IPC, scheduled ingestion) with the **RAVEN_MESH / NEXUS / VIEWER**
agent+UI stack into a coherent single system, without re-inventing what each already
solved.

---

## 1. Per-repo teardown

### 1.1 Pulse — the ingestion engine

**Shape.** Electron 32 + Vite + React 18 + TypeScript + Tailwind. Menu-bar app for
macOS. All persistence in a single `better-sqlite3` file at
`~/Library/Application Support/Pulse/pulse.db`. **No accounts, no cloud, no telemetry.**
Renderer is pure UI; main process owns the DB, polling, AI calls, and scheduling.

**Entry points.**
- [`_ingest/Pulse/src/main/index.ts`](_ingest/Pulse/src/main/index.ts) — Electron main: tray, windows, splash, boot orchestration.
- [`_ingest/Pulse/src/preload/index.ts`](_ingest/Pulse/src/preload/index.ts) — typed `window.api` `contextBridge` surface. Renderer never touches `ipcRenderer` directly.
- [`_ingest/Pulse/src/main/ipc/handlers.ts`](_ingest/Pulse/src/main/ipc/handlers.ts) — ~3500 LOC of `ipcMain.handle` registrations, channels grouped by prefix.
- [`_ingest/Pulse/src/renderer/App.tsx`](_ingest/Pulse/src/renderer/App.tsx) — ~5000 LOC owning routing + feed list + reader.

**IPC contract (the part to keep).** Channels are namespaced by prefix:
- `db:*` — every DB operation (categories, feeds, articles, tickers, geo, prefs, …)
- `feeds:*`, `stocks:*`, `reels:*`, `sports:*`, `hyper:*`, `discovery:*`, `lookup:*`, `find:*`, `reader:*`, `research:*`, …
- The renderer imports a typed `api` object from preload; no string-channel calls in components.
- **Pattern:** "DB ops stay in main. Renderer is dumb glass."

**Database.** Migration system at v25 ([`_ingest/Pulse/src/main/database/migrations.ts`](_ingest/Pulse/src/main/database/migrations.ts)).
~35 tables: articles, feeds, categories, tickers, ticker_summaries, ticker_financials,
ticker_estimates, ticker_alerts, sec_filings, earnings_releases, geo_interests,
discovery_suggestions, preferences, reels, hyper_chats, favorite_teams, favorite_athletes,
graph_candidates/overrides/node_overrides, company_value_chains, chain_corrections,
fred_observations, research_topics/briefs/bookmarks/foundational/recent_searches,
morning_briefs, notification_log, …

**Services (the engine room — `_ingest/Pulse/src/main/services/`).** ~50 files,
~10–20 startup schedulers. Patterns worth lifting wholesale:

| Service | Pattern |
|---|---|
| `feedPoller.ts` | Bounded-concurrency RSS poll (6 parallel feeds), per-poll AI budget (≤20 Ollama calls), **deferred idle drain** for overflow (only fire when `powerMonitor.getSystemIdleTime() > 60s`), suspend/resume hooks, cold-start "notifications armed" gate, defer if ML workers are loading. |
| `stocksScheduler.ts` | **Three-cadence market-aware scheduler**: 60s during US trading hours, 1h weekday off-hours, 6h weekends. NY-timezone via `Intl`. Yahoo primary → Stooq fallback if <50 % priced quotes. Skips fetch when no window is visible. |
| `ollamaService.ts` | Bounded concurrency (2), 60s health cache, `mistral:7b` default, env overrides. |
| `urgencyScorer.ts` + `data/keywordDictionaries.ts` | Two-pass: keyword score 0–5, AI promotion at score=3 ambiguous. |
| `readerService.ts` | `@mozilla/readability` + `jsdom@24` + `DOMPurify`, 7-day cache. |
| `adblockerService.ts` | `@ghostery/adblocker-electron` on every session — network-level. |
| `maintenanceService.ts` | Daily purge: 30d retention unless bookmarked + VACUUM at ≥200 rows. |
| `notificationManager.ts` | Digest timer + per-domain urgency-armed gate; suppress on first poll. |
| Domain schedulers | `financialsService`, `earningsScheduler`, `analystEstimatesService`, `secFilingsService`, `earningsReleasesService`, `graphCandidatesService`, `tenKConcentrationService`, `graphNotesRefreshService`, `sportsReelScheduler`, `sportsAlertsService`, `discoveryService`, `researchScheduler`, `reelService` — same shape: a `startXxxScheduler()` / `stopXxxScheduler()` exported from each, all started in `main/index.ts`. |
| `reelService.ts` + Python workers | Optional 30s AI video reels via Kokoro TTS + SDXL. Served to renderer via custom `reel://` privileged Electron protocol with `..`/`/` path validation. |

**Boot orchestration ([`_ingest/Pulse/src/main/index.ts:189-213`](_ingest/Pulse/src/main/index.ts)).** Splash window held until all schedulers warm; 180s watchdog; renderer signals ready; 2-frame compositor settle before reveal. **This is what keeps cold start from showing jitter.**

**Gotchas worth carrying forward (from `CLAUDE.md`).**
- `jsdom` pinned to v24 (v25+ pulls ESM-only deps that Electron CJS `require()` can't load).
- `dock.hide()` strands tray on macOS Sequoia — left visible intentionally.
- Splash → reveal sequencing is load-bearing; don't move heavy init out of the gate.
- `visibilitychange` alone is wrong — listen on `blur`/`focus` too (occlusion).
- No `backdrop-blur` on viewport-filling overlays (composition cost in packaged builds).
- No perpetual CSS `animation: ... infinite` rules — use rAF-driven `scrollLeft` for marquees. Screen-sharing on macOS shows jitter otherwise.

**Pulse's contribution to Aether.** The *engine room*: polling primitives, schedulers
that respect power/idle/market state, the typed-preload IPC pattern, the SQLite-as-
source-of-truth discipline, and ~50 domain services we can lift one at a time
(finance, news, sports, reels, …) as Aether "tool-modules."

---

### 1.2 RAVEN_MESH — the protocol bones

**Shape.** Python 3 + aiohttp. **~1500 LOC** in [`_ingest/RAVEN_MESH/core/core.py`](_ingest/RAVEN_MESH/core/core.py). A single-
process broker. Status v0.4. The protocol *is* the contract; the broker is the
conformance test.

**Vocabulary.**
- **Node** — any participant with a stable `id` and HMAC secret.
- **Surface** — typed entry point on a node: `{node_id}.{surface_name}`, `type: tool|inbox`, `invocation_mode: request_response|fire_and_forget`, JSON Schema for input.
- **Relationship (Edge)** — directed `(from_node, to_surface)`. **Edge present ⇒ permitted. Edge absent ⇒ denied.** No roles, no policies, no priorities.
- **Manifest** — YAML declaring nodes + surfaces + relationships. The graph.
- **Envelope** — unit of mesh traffic; HMAC-SHA256 over canonical JSON.

**Wire ([`_ingest/RAVEN_MESH/docs/SPEC.md`](_ingest/RAVEN_MESH/docs/SPEC.md)).** Four HTTP endpoints on Core:
- `POST /v0/register` — registration body (node_id + timestamp + signature) → `{session_id, kind, surfaces, relationships}`.
- `POST /v0/invoke` — full envelope, `kind=invocation`. Returns 200 (response), 202 (fire-and-forget accepted), or 400/401/403/404/503/504 errors.
- `POST /v0/respond` — `kind=response|error` correlated by `correlation_id`.
- `GET /v0/stream?session=<id>` — long-lived SSE; `event: deliver` for envelopes, `: heartbeat` keepalive.

Plus operator-only `/v0/healthz`, `/v0/introspect`, and (admin-token-gated) `/v0/admin/stream` + `/v0/admin/metrics` (Prometheus).

**The reserved `core` node ([`_ingest/RAVEN_MESH/core/core.py:62-68`](_ingest/RAVEN_MESH/core/core.py#L62-L68)).** Core itself is a node with id `core`, secret from `MESH_CORE_SECRET`, and exactly 11 surfaces:
`state, processes, metrics, audit_query, set_manifest, reload_manifest, spawn, stop, restart, reconcile, drain`. Reachable only via allow-edges. **No `/v0/admin/*` control plane** — manifest reload, spawn, etc. travel `/v0/invoke` like every other interaction.

**Security model.**
- HMAC-SHA256 on every envelope, constant-time compare.
- Replay window 60s (bounded `[5, 300]`).
- Nonce LRU (16k entries, shared across all routes).
- Audit log: one JSON line per `routed`/`denied_*`/`timeout` decision in `audit.log`.
- Schema-validated payloads via `jsonschema`.

**Supervisor ([`_ingest/RAVEN_MESH/core/supervisor.py`](_ingest/RAVEN_MESH/core/supervisor.py), ~750 LOC).** Optional in-Core process supervisor. ChildSpec with restart policies (`permanent | transient | temporary | on_demand`), exponential backoff (0.5s → 30s cap), idle-shutdown for `on_demand`, in-flight counter for graceful drain. BEAM-inspired but simplified.

**SDK ([`_ingest/RAVEN_MESH/node_sdk/__init__.py`](_ingest/RAVEN_MESH/node_sdk/__init__.py), ~310 LOC).** `MeshNode(node_id, secret, core_url)` → `.on(surface, handler)`, `.start()`, `.invoke(target, payload)`, `.respond(env, payload)`. Handlers return `dict` (response), `None` (no response, fire-and-forget), or raise `MeshDeny(reason)` for an error envelope.

**Stream-not-queue philosophy ([`_ingest/RAVEN_MESH/docs/PHILOSOPHY.md`](_ingest/RAVEN_MESH/docs/PHILOSOPHY.md)).** Disconnected nodes get `503 denied_node_unreachable`; envelopes are *not* queued for redelivery. Durability is an application concern — explicit queue nodes or app-level retry/idempotency.

**Configuration.** TOML `mesh.toml` with CLI > env > TOML > default precedence. Secrets (`ADMIN_TOKEN`, `MESH_CORE_SECRET`, per-node identity_secrets) are env-only.

**Notable design choices marked as permanent in PHILOSOPHY.md.**
- No `core.invoke_as` (identity spoofing as a primitive — class break of HMAC).
- No caveats / delegation / ephemeral tokens / capability introspection (each can be expressed with existing primitives + an approval/queue/cron node).
- No Last-Event-ID resume (re-register on reconnect).

**RAVEN_MESH's contribution to Aether.** The *spine*: a small, disciplined, signed, audited substrate for **every** inter-module call — Pulse modules, agents, UI, voice — uniformly modeled as mesh nodes. Authorization-by-graph beats the per-route auth NEXUS currently lacks.

---

### 1.3 NEXUS — the agent runtime

**Shape.** Node.js (Express + WebSocket) API at port 3001 + React/Vite dashboard at port 5173 + Docker per-agent cells running a TypeScript "engine" (Express + SSE). Optional MCP server bundled.

**Topology.**
```
Dashboard (React, 5173)
        │ HTTP + SSE
        ▼
   API (Express, 3001) ──► Docker socket ──► Cell containers (3101+)
        │                                       │
        ├── data/agents.json                    ├── /opt/engine (Express + Claude Agent SDK)
        ├── data/queues/{id}.json               ├── /ledger volume (identity, memory, skills, session_id)
        ├── data/mailbox/{teamId}.json          └── /workspace volume (agent's projects)
        ├── data/team-events/{teamId}.json
        └── data/teams.json + runs/ + boards/
```

**API ([`_ingest/NEXUS/api/src/`](_ingest/NEXUS/api/src/)).** Routes: `agents`, `volumes`, `teams`, `mailbox`, `boards`, `uploads`, `cellTypes`. Services: `docker`, `engine`, `queueConsumer`, `volume`, `volumes`, `mailbox`, `boards`, `runs`, `teams`, `peers`, `cron`, `credentials`, `terminal`, `cronScheduler`, `oauthSync`, `healthCheck`. JSON-file persistence with simple async-mutex locks (`stateLock`, `mailboxLock`, `teamLock`).

**Queue consumer ([`_ingest/NEXUS/api/src/services/queueConsumer.ts`](_ingest/NEXUS/api/src/services/queueConsumer.ts)).** Per-agent in-memory consumer:
- Opens SSE to the cell engine's `/logs` endpoint.
- Dequeues *all* pending messages as a batch, formats them with `[N/M] (timestamp)` prefixes, dispatches to engine via `sendMessage`.
- Waits for `agent_complete` / `agent_error` SSE events; 1-hour safety drain timer.
- Detects OAuth/auth errors → auto-pauses the agent (status=`paused`, retains `pausedMessageIds` for resume).
- Retry with backoff on recoverable errors, max 3 retries.
- Reconnects SSE on disconnect.
- Creates a `Run` (per team) only after successful dispatch; emits team events (`processing_started`/`completed`/`failed`).

**Cell engine ([`_ingest/NEXUS/cell/engine/src/main.ts`](_ingest/NEXUS/cell/engine/src/main.ts)).** Express + SSE. `CELL_MODE` env selects `sdk | cli | gemini | codex`. On each invocation, assembles a system prompt from `/ledger/identity.md` + `/ledger/memory/index.md` + skill index (frontmatter from `/ledger/skills/*/SKILL.md`) + peer-agent list (from a peers cache) + (if `TEAM_ID`) human-mailbox blurb. Session ID persisted at `/ledger/session_id` for cross-invocation continuity. Token usage counters. Abort controller for cancel.

**Docker layer ([`_ingest/NEXUS/api/src/services/docker.ts`](_ingest/NEXUS/api/src/services/docker.ts)).** `dockerode`-driven. Each agent gets a container `nexus-agent-{id}` from image `nexus-cell:latest`, with named volumes `nexus-ledger-{id}` and `nexus-workspace-{id}` (and optional team `nexus-team-{teamId}`). Files in/out via Docker exec + tar archive when running, `getArchive()` when stopped.

**Teams + mailbox + boards.** Team = shared docker volume + event log + mailbox + kanban boards + runs. Mailbox: `agent_to_human` / `human_to_agent` JSON messages (subject/body/category, 500-cap, attachments). Runs: per-trigger (`mail | cron | manual | intercom`) execution record with event IDs. Boards: kanban with columns + cards + activity entries.

**Cron ([`_ingest/NEXUS/api/src/services/cronScheduler.ts`](_ingest/NEXUS/api/src/services/cronScheduler.ts)).** Three schedule kinds (`cron | at | every`). Enqueues a message to an agent when fired.

**MCP server ([`_ingest/NEXUS/mcp/src/index.ts`](_ingest/NEXUS/mcp/src/index.ts)).** `@modelcontextprotocol/sdk` stdio server. Tools registered for: agents, messaging (intercom), files, skills, cron, teams, mailbox, volumes, history, cell-types, boards. **This is how a Claude Code agent running *inside a cell* calls back into NEXUS** — to send mail, message peers, schedule itself, etc.

**Security state ([`_ingest/NEXUS/AUDIT.md`](_ingest/NEXUS/AUDIT.md), 70 findings).** This is a **prototype audit, not a production codebase**. The critical ones we must not carry forward unfixed:
1. Docker socket mounted into API container → root on host.
2. **Zero auth on every endpoint** (API, engine, WebSocket terminal).
3. No container resource limits (mem/CPU/PIDs).
4. No agent network isolation (agents can reach Docker socket).
5. Path traversal in `/skills/:name`, `/files/*`, `startsWith('/workspace')` checks.
6. Non-atomic `agents.json` writes — crash mid-write deletes everything.
7. Many orphan-container / consumer-leak / status-limbo races on delete/stop.
8. No React Error Boundaries; symlink-following file API; YAML injection in skills.

**NEXUS's contribution to Aether.** Concepts to lift: **Ledger pattern** (identity + memory + skills + session, mounted volume so the agent can self-edit), **agent + team + mailbox + run** as first-class concepts, **MCP-callback** for in-agent tool calls back to the host, **cron + at + every** scheduling. Code to *reuse cautiously* (route handlers, Docker patterns) with the AUDIT.md fixes applied. Code to *not* carry forward as-is: queue consumer's poll-and-drain shape (replace with mesh edges and SSE delivery already in RAVEN_MESH).

---

### 1.4 VIEWER — the surface

**Shape.** Electron 33 + React 19 + Tailwind 4 + Zustand + Monaco + xterm.js + @anthropic-ai/claude-agent-sdk. A multi-window/multi-tab desktop workspace where files are the source of truth and apps are auto-discovered modules.

**App model ([`_ingest/VIEWER/AGENTS.md`](_ingest/VIEWER/AGENTS.md)).** Drop a folder into [`_ingest/VIEWER/apps/viewer/src/apps/{name}/`](_ingest/VIEWER/apps/viewer/src/apps/) with an `index.ts` that exports an `AppDefinition`:

```ts
export const app: AppDefinition = {
  id: 'my-app',
  name: 'My App',
  icon: 'Sparkles',                       // Lucide name
  component: MyApp,
  fileTypes: ['xyz'],                     // file-based (omit for standalone)
  defaultSize: { width: 400, height: 300 }
};
```
…and it auto-registers via `import.meta.glob`. App context gives `fileApi.readFile`, `fileApi.writeFile`, `setDirty`, `setSuspended`, `closeTab`, `openFile`, `openWindow`, `updateTab`.

**27 built-in apps** (file-based + standalone, exhaustive list in [`_ingest/VIEWER/apps/viewer/src/apps/`](_ingest/VIEWER/apps/viewer/src/apps/)): Monaco code editor, terminal (`node-pty` + xterm), file explorer, markdown editor (Tiptap), mermaid renderer, PDF viewer (`pdfjs-dist`), kanban (`.kanban`), knowledge-graph (`@xyflow/react`), 3D scene (`react-three-fiber`/`drei`), latex viewer (`katex`), audio player, image viewer, browser (webview), html-preview, calculator, sound-designer, airplane-physics, optics, json-viewer, dependency-graph, **agent-manager**, **raven-control**, **raven**, **mcp-inspector**, api-manager, settings, keyboard-shortcuts, leap-settings.

**Electron main ([`_ingest/VIEWER/apps/viewer/electron/main/`](_ingest/VIEWER/apps/viewer/electron/main/)).**
- IPC handlers split per concern: `fileHandlers`, `configHandlers`, `terminalHandlers`, `browserHandlers`, `agentTaskHandlers`, `ravenHandlers`, `mcpHandlers`, `leapServiceHandlers`, `claudeHandlers`, `whisperHandlers`.
- Services: `fileWatcher` (`@parcel/watcher`), `controlServer`, `mcpServerManager`, `claudeService`, `ravenDaemonManager`, `daemonManager`.
- Intercepts `before-input-event` for `Cmd+/` (Claude palette) and `Cmd+arrows` (window focus) — bypasses Monaco's aggressive key capture.

**Daemon-manager pattern (the key idea).** Background work lives in detached Node daemons, not in the Electron main:

| Daemon | Port | Role |
|---|---|---|
| **agent-daemon** ([`_ingest/VIEWER/apps/agent-daemon/`](_ingest/VIEWER/apps/agent-daemon/)) | 7432 | HTTP+WS server executing agent tasks. Persists task state. Reconnects to running tasks across restart. PID-file + health-check + `unref()` so it survives viewer exit. |
| **raven-daemon** ([`_ingest/VIEWER/apps/raven-daemon/](_ingest/VIEWER/apps/raven-daemon/)) | 7433 | HTTP+WS server managing the **Python Raven voice assistant** (`apps/raven/main.py`). Streams transcripts + function-call logs. Manages memory store + tools + audio device selection. |

Both managers (`DaemonManager`, `RavenDaemonManager`) share an identical pattern:
1. `ensureRunning()` checks `/health`; if down, looks up daemon entry via 4 candidate paths.
2. `spawn('node', [...], { detached: true, stdio: 'ignore' })` + `unref()`.
3. PID file in `app.getPath('userData')/<daemon>/daemon.pid`.
4. Stale PID file is reaped before respawning.
5. Generic HTTP `request<T>(method, path, body)` helper.

**Python Raven ([`_ingest/VIEWER/apps/raven/`](_ingest/VIEWER/apps/raven/)).** Flask backend with `raven_core/` containing `orchestrator`, `client`, `vision`, `audio`, tools (`time_tool`, `memory_tool`, `system_tool`, `silence_tool`, `cerebras_tool`), and a JSON-file memory store. Gemini Live API for the live bidirectional audio loop (voice + vision); Cerebras Cloud SDK only as a side-tool for fast HTML/UI generation via `cerebras_tool`.

**Holographic design system.** CSS vars: `--holo-bg`, `--holo-text`, `--holo-muted`, `--holo-accent`, `--holo-border`. Translucent panels (`bg-[rgba(15,15,25,0.5)]`), subtle glows, status pills (green/red/yellow/blue).

**VIEWER's contribution to Aether.** The *surface*: the modular app system, command palette (`Cmd+P`), file-as-source-of-truth doctrine, the daemon-manager pattern (detached background processes that survive UI restart), and the voice/agent integration shape. The 27 apps are largely portable — most are pure-renderer with `fileApi` access.

---

## 2. Capability matrix

| Capability | Pulse | RAVEN_MESH | NEXUS | VIEWER |
|---|---|---|---|---|
| **Local-first storage** | SQLite (canonical) | audit.log | JSON files | files-on-disk |
| **IPC bridge (renderer↔main)** | typed `contextBridge`, ~3500 LOC handlers | — | — | typed `contextBridge`, split handlers |
| **Polling / schedulers** | ~20 cadence-aware schedulers (market hours, idle, suspend/resume) | — | cron + at + every (per-agent) | per-tab `isActive` pause |
| **AI-call bounding** | concurrency 2 + per-poll budget + idle drain | — | — | — |
| **Inter-component protocol** | string-channel IPC | **signed-envelope mesh + edge graph + audit** | HTTP+SSE between API↔cell | HTTP+WS to local daemons |
| **AuthZ** | none (single user) | **edge graph** (only correct one) | none (audit critical) | none (single user) |
| **Process supervision** | — | **on-demand spawn + drain + exp-backoff** | Docker + restart policy | detached daemons + PID files |
| **Agent runtime** | Ollama calls only | — | **Docker cells (Claude Code/SDK/Gemini/Codex)** | in-process Claude Agent SDK + detached daemon |
| **Agent self-modification** | — | — | **ledger volume (identity/memory/skills)** | files-on-disk |
| **Inter-agent messaging** | — | invoke surface | mailbox + intercom + MCP | — |
| **MCP** | — | — | **MCP server bundled** | MCP server manager (Electron-side) |
| **Voice / multimodal** | TTS reels (offline) | — | — | **Raven voice (Gemini Live + vision)** |
| **Modular UI apps** | monolithic App.tsx | — | dashboard (fixed pages) | **27 auto-discovered apps** |
| **Command palette** | — | — | — | **Cmd+P fuzzy across apps/files/AI** |
| **Notifications** | tray + digest + per-domain armed flag | — | team events | — |
| **Adblock / privacy** | network-level (every session) | — | — | — |
| **Data ingestion (domain)** | **finance, news, sports, SEC, FRED, earnings, wiki, …** | — | — | — |
| **File watcher** | — | — | — | `@parcel/watcher` reactive tree |

**Reading the matrix.** Each repo is dominant in one column. There is *very little* genuine overlap — RAVEN_MESH and NEXUS both deal with agents, but RAVEN_MESH is the *transport*; NEXUS is the *workload*. VIEWER and NEXUS both have dashboards, but VIEWER is the personal workspace, NEXUS is the agent fleet console.

The synthesis writes itself once you see this: **one protocol (mesh) + one engine pattern (Pulse-style schedulers as mesh nodes) + one runtime (NEXUS-style cells, hardened, registered as mesh nodes) + one surface (VIEWER, with NEXUS dashboard surfaces folded into it as apps).**

---

## 3. Integration seams — concrete fusion points

This is the part Opus 4.7 most needs. For each pairing, the *seam* is the API or invariant where one repo's primitive plugs into another's.

### 3.1 Pulse polling → RAVEN_MESH nodes

The Pulse main process today runs ~20 schedulers in a single Electron process. In
Aether each becomes a **mesh node** with the same shape:

| Pulse module | Becomes mesh node | Surfaces |
|---|---|---|
| `feedPoller.ts` | `news.feeds` | `poll_now` (tool, fire-and-forget), `new_article` (inbox), `subscribe_articles` (tool→stream) |
| `stocksScheduler.ts` | `finance.quotes` | `latest` (tool), `subscribe` (inbox), `refresh_now` (tool) |
| `earningsScheduler.ts` | `finance.earnings` | `latest`, `for_symbol` |
| `secFilingsService.ts` | `finance.sec` | `for_symbol`, `recent` |
| `ollamaService.ts` | `ai.ollama` | `score`, `summarize`, `definition` |
| `urgencyScorer.ts` | (in-process to `news.feeds`) | — |
| `sportsService.ts` | `sports.live` | `games`, `for_team` |
| `notificationManager.ts` | `host.notifications` | `notify_urgent` (inbox) |
| `readerService.ts` | `news.reader` | `extract` |
| `smartLookupService.ts` | `knowledge.lookup` | `term` |

**Seam contract.** Every Pulse service exposes `start/stop` today; converting each to
a mesh node means:
1. Wrap the existing service in a `MeshNode` (`node_sdk/__init__.py` is the reference;
   Node-side SDK is a 3-method `register/stream/invoke` per `SPEC.md §10` — port it to
   TypeScript, ~200 LOC).
2. Define its surfaces in `manifest.yaml` with JSON Schemas (Pulse's existing IPC
   handler signatures map almost 1:1).
3. Replace internal `import { … } from '…'` glue with `await node.invoke('other.surface', payload)`.
4. Cadence/polling lives *inside* the node, fired by its own timer — the mesh only
   carries the *result*.

**Critical preservation.** The Pulse scheduling intelligence (market-aware cadences,
idle-drain AI budget, suspend/resume hooks, per-poll budget) must move *into* the node,
not be diluted across nodes. The mesh is dumb transport.

### 3.2 RAVEN_MESH ↔ NEXUS cells

Replace NEXUS's per-agent HTTP+SSE consumer with the mesh:

- Each NEXUS cell **registers as a mesh node** (id = `agent.{agentId}`, secret from a cell-local env).
- Surfaces on the cell: `inbox` (incoming message — `inbox` type, fire-and-forget), `cancel` (tool), `health` (tool), `state` (tool).
- The current API "queue consumer" → an `orchestrator` mesh node that:
  - On enqueue, invokes `agent.{id}.inbox` (fire-and-forget = 202).
  - Subscribes to a *response inbox* the cell uses to signal completion (or uses the regular response envelope — better, since `request_response` is built in).
- `core.spawn` / `core.stop` / `core.reconcile` replace the Express start/stop routes.
- Team mailbox = a manifest edge from every `agent.{id}` to a shared `mailbox.{teamId}.send` surface, plus an edge back from `mailbox.{teamId}` to each agent's `inbox`.
- **Auth shows up for free.** Today NEXUS has zero auth on `/api/*` and the cell engine. In the mesh, every call is HMAC-signed and edge-checked.

**The MCP-callback story.** NEXUS today wraps its API in an MCP server so Claude
Code *inside* a cell can call back. In Aether that becomes: **MCP server is itself a
mesh node** (`mcp.{name}`), and Claude Code's `Use Tool` invokes mesh surfaces via the
MCP bridge. One uniform call graph; mesh edges decide which agents can call which tools.

### 3.3 NEXUS cells → VIEWER apps

VIEWER's `agent-manager` app is the natural home for the dashboard NEXUS ships
separately today. Concretely:

- Reuse NEXUS's dashboard React components (`AgentDetail`, `WorkspaceTab`, `LedgerTab`, `TerminalView`, `ConversationTab`, `TeamKanbanTab`, `TeamMailboxTab`, `OrchestratorPage`) as **VIEWER apps** wrapped in the `AppDefinition` shape.
- Replace the NEXUS dashboard's HTTP/SSE client with mesh calls via VIEWER's existing daemon-manager pattern: the **agent-daemon** becomes a mesh node that proxies to Core, exposing the same surface API.
- The kanban app already exists in VIEWER (`apps/kanban/`); NEXUS's `TeamKanbanTab` collapses into it with a `.kanban` file rendered straight from the team's board store.

### 3.4 Pulse data + VIEWER apps

The 27 VIEWER apps already include slots for these tool-modules. Map Pulse's domain
data to existing/new VIEWER apps:

| Pulse data | VIEWER app | File-type or shape |
|---|---|---|
| Articles + feeds | new `news` app | `.feed` files? or live SSE-only |
| Tickers + financials + value chains | new `finance` app | per-ticker `.ticker` file with computed snapshot |
| Earnings + SEC filings | inline panes in `finance` app | — |
| Sports box scores | new `sports` app | live-only |
| Reels (AI videos) | existing `audio-player` + new `reels` | `.reel` file → `reel://` protocol |
| Research briefs | existing `markdown-editor` | `.md` already supported |
| Hyperintelligence chats | existing `text-editor` or new `chat` app | `.hyper` file |
| Knowledge graph (value chains) | existing `knowledge-graph` app | xyflow-compatible JSON |
| Sec/earnings calendar | existing `kanban` or new `calendar` app | — |

The point: every Pulse renderer component (most of `_ingest/Pulse/src/renderer/components/*.tsx` — `ResearchPage`, `ResearchMap`, `ValueChain`, `EarningsBeatMiss`, `MacroPanel`, `Discovery`, `Reels`, `Hyperintelligence`, `TickerSearchBox`, `PeerCompareModal`) is already a self-contained React component with its data needs visible. They convert to VIEWER apps with `fileApi` + mesh-node-of-record. Pulse's monolithic `App.tsx` becomes the *layout* of one VIEWER window pre-configured for "investing mode."

### 3.5 Cross-cutting: voice (Raven) as a mesh citizen

VIEWER's raven-daemon today is HTTP+WS-talking-to-Python. In Aether:
- `raven-daemon` registers as `voice.raven` mesh node.
- Surfaces: `start_listening`, `stop`, `set_mode` (`camera | screen | none`), `transcript` (inbox), `function_call` (inbox).
- Raven's "tools" (currently inlined Python functions) become edges into other mesh nodes: a `system_tool` call → `host.shell.exec`, `memory_tool` → `voice.memory.write`, `cerebras_tool` → `ai.cerebras.complete`.
- Voice becomes a *user* of mesh-mediated capabilities, not a parallel stack.

---

## 4. Conflicts and rewrites Opus will need to resolve

These are the real architectural disagreements between the four repos. Each forces a
choice; no fudge possible.

### 4.1 Sync model: typed-bridge IPC vs. signed-envelope mesh

- **Pulse + VIEWER** use Electron `contextBridge` with string channels (`db:articles:list`, `fs:readFile`). Fast, in-process, no auth (single trusted user).
- **RAVEN_MESH** uses signed envelopes over HTTP. Cross-process, auditable, edge-checked.
- **NEXUS** uses HTTP+SSE between API and cells, plus HTTP+WS to dashboard. No auth, no audit.

**Decision required.** Pick *one* canonical transport for Aether:
- (a) **Mesh everywhere.** Renderer talks to the local Core via the same protocol. Heavy: every IPC call goes through HMAC + edge check. But uniform.
- (b) **Mesh between processes, contextBridge inside Electron.** The renderer↔main bridge stays as Pulse/VIEWER do today (string channels, typed). Main process is a mesh node and brokers any cross-process calls. **Recommended** — keeps the hot path fast, only pays mesh overhead when crossing process lines.
- (c) **Mesh between modules, plain HTTP inside.** Status quo NEXUS-style, doesn't solve auth.

### 4.2 Persistence: SQLite vs. JSON files vs. Docker volumes

- **Pulse** = one SQLite file, migrations, transactional.
- **NEXUS** = many JSON files + Docker named volumes (per-agent ledger + workspace).
- **VIEWER** = files-on-disk in the user's workspace folder.
- **RAVEN_MESH** = `audit.log` JSONL + the manifest YAML; no other state.

**Decision required.** Aether picks:
- SQLite (`~/Library/Application Support/Aether/Aether.db`) for **structured data** with relations: articles, tickers, financials, agents, runs, mailbox, boards, audit-derived indexes.
- File tree (`~/Aether/` workspace root) for **user-facing artifacts**: research briefs, kanban files, reels, agent ledger directories (per-agent: `~/Aether/.agents/{id}/{identity.md, memory/, skills/, session_id}`).
- Mesh audit log untouched at `~/Aether/.mesh/audit.log`.
- **Replace NEXUS's Docker named volumes with bind-mounted host directories** rooted under `~/Aether/.agents/`. Loses some isolation; gains transparency, backup, and the ability to use VIEWER's existing file apps against the ledger directly.

### 4.3 Agent isolation: Docker vs. process vs. in-Electron

- **NEXUS** = one Docker container per agent. Strong isolation. Heavy. Many security gaps in current shape.
- **VIEWER agent-daemon** = single Node process spawning agent tasks. Lightweight. No isolation.

**Decision required.** Likely **macOS-native first**: run agents as macOS subprocesses
with `sandbox-exec` profiles or `bwrap`-equivalent (much lighter than Docker, no
socket exposure, integrates with Keychain for credential sync). Docker becomes the
opt-in heavy isolation for untrusted code. Either way, **fix the AUDIT.md criticals**
before exposing the orchestrator to anything that talks to the network.

### 4.4 Manifest source of truth

- **RAVEN_MESH** demands a single YAML manifest at boot, with `core.set_manifest` for runtime edits.
- **NEXUS** stores agent definitions in `agents.json`.
- **Pulse** has no manifest concept — services are wired in `main/index.ts` imports.

**Decision required.** Adopt RAVEN_MESH's manifest as the system-of-record. Agent
records (currently in `agents.json`) become entries in `manifest.yaml` under
`nodes:`. The dashboard's "Create Agent" flow becomes `core.set_manifest` plus a
spawn. **Edges become the Aether permission model** — when a user says "let the
research agent read my brokerage statements," that's a new edge from
`agent.research` to `finance.brokerage.read`.

### 4.5 Scheduling: Pulse-style schedulers vs. NEXUS cron

- **Pulse** = ~20 hardcoded schedulers with market-aware / idle-aware logic baked in.
- **NEXUS** = generic `cron | at | every` per-agent; agent-side decides what to do.

**Decision required.** Two-tier:
- **System schedulers** (Pulse-style, embedded in their owning mesh node): finance quote cadence, RSS poll, daily SEC sweep — these have domain logic that doesn't generalize.
- **User-facing schedules** (NEXUS-style): "every weekday at 6:30 AM, run the morning brief agent." Stored as records, served by a `scheduler.cron` mesh node that fires `inbox` invocations.

### 4.6 LLM provider strategy

- **Pulse** = Ollama local, optional Claude (`claudeService.ts`).
- **NEXUS** = Claude Code CLI / Anthropic SDK / Gemini CLI / Codex CLI.
- **VIEWER** = `@anthropic-ai/claude-agent-sdk` + Gemini Live (voice + vision) + Cerebras (fast HTML-gen side-tool).

**Decision required.** Single `ai.*` namespace with multiple nodes: `ai.claude`, `ai.ollama`, `ai.cerebras`, `ai.gemini`. Each agent/feature edge-permits the providers it should use. Voice (latency-bound, live bidirectional audio) defaults to Gemini Live (Cerebras has no live-audio API as of this writing); fast text / HTML generation defaults to Cerebras; deep reasoning to Claude; private/offline to Ollama; vision to Gemini.

### 4.7 Stream-not-queue vs. NEXUS's queue + retry

RAVEN_MESH explicitly rejects in-broker queuing. NEXUS leans heavily on its queue +
retry + drain-timer machinery.

**Resolution.** Both are right *for their scope*. The mesh transport stays
stream-only (no Last-Event-ID, 503 on unreachable). The orchestrator mesh node (the
ex-NEXUS-API) owns durable per-agent queues — same code, same retries — but
*expressed in the application layer above the mesh*. The PHILOSOPHY.md authors
already anticipated this.

---

## 5. Proposed Aether skeleton

Directory layout under `~/Aether` / the source tree:

```
Aether/
├── core/                       # RAVEN_MESH Core, vendored or git-submoduled
│   ├── core/                   # core.py, supervisor.py, manifest_validator.py, config.py
│   ├── node_sdk/               # Python SDK
│   ├── node_sdk_ts/            # NEW: TypeScript port of node_sdk (~200 LOC, see §6)
│   ├── schemas/
│   └── mesh.toml
│
├── manifest.yaml               # Single source of truth for nodes + edges
│
├── nodes/                      # Each subdirectory is a mesh node implementation
│   ├── orchestrator/           # ex-NEXUS-API. Owns queues, runs, mailbox, boards.
│   │   ├── src/
│   │   └── manifest_node.yaml  # this node's surfaces, included by root manifest
│   ├── news_feeds/             # ex-Pulse feedPoller + rssParser + urgencyScorer
│   ├── finance_quotes/         # ex-Pulse stocksScheduler + yahoo + stooq
│   ├── finance_earnings/
│   ├── finance_sec/
│   ├── sports_live/
│   ├── ai_claude/              # claude-agent-sdk wrapper
│   ├── ai_ollama/
│   ├── ai_cerebras/
│   ├── ai_gemini/
│   ├── knowledge_lookup/       # wikipedia + ollama fallback
│   ├── host_notifications/     # macOS native notifications
│   ├── host_shell/             # sandboxed shell exec
│   ├── voice_raven/            # ex-VIEWER raven-daemon + Python raven
│   ├── scheduler_cron/         # user-facing cron + at + every
│   └── agent_runtime/          # NEW: spawns/manages agent subprocesses (NEXUS-cell shape, hardened)
│
├── shell/                      # ex-VIEWER: the Electron user-facing app
│   ├── electron/main/          # IPC handlers, daemon manager, mesh-client bridge
│   ├── electron/preload/       # contextBridge — proxies to mesh via main
│   └── src/
│       ├── apps/               # 27 viewer apps + new Aether apps
│       │   ├── news/           # NEW — consumes news_feeds mesh node
│       │   ├── finance/        # NEW — consumes finance.* mesh nodes
│       │   ├── sports/         # NEW
│       │   ├── reels/          # NEW (Pulse reel:// protocol carried over)
│       │   ├── agent-manager/  # NEW — replaces NEXUS dashboard
│       │   ├── ... (rest of VIEWER's apps)
│       └── stores/             # Zustand stores for app state
│
├── agents/                     # Per-agent ledger directories (bind-mounted into runtimes)
│   └── {agentId}/
│       ├── identity.md
│       ├── memory/index.md
│       ├── skills/{name}/SKILL.md
│       └── session_id
│
├── data/
│   ├── Aether.db               # SQLite (Pulse-style)
│   ├── workspaces/             # User files
│   └── .mesh/audit.log
│
└── docs/
    ├── ARCHITECTURE.md         # high-level
    ├── ADDING_A_TOOL.md        # how to add a new tool-module = new mesh node
    └── ADDING_AN_APP.md        # how to add a new VIEWER app
```

**Process topology (running system).**

```
Electron Shell (Aether app)
  ├─ main process
  │   ├─ contextBridge handlers → forwards renderer calls to mesh
  │   ├─ DaemonManager → ensures Core + critical nodes are up
  │   └─ Mesh client (TS SDK) registered as node "shell"
  └─ renderer (apps)

Core (Python aiohttp, port 8000)
  └─ Supervisor (optional) spawns/monitors nodes

Mesh nodes (each its own process, registered to Core via /v0/register):
  - orchestrator      (Node.js)
  - news_feeds        (Node.js, lifts Pulse code)
  - finance_quotes    (Node.js)
  - finance_earnings  (Node.js)
  - finance_sec       (Node.js)
  - sports_live       (Node.js)
  - knowledge_lookup  (Node.js)
  - ai_claude / ai_ollama / ai_cerebras / ai_gemini (any language)
  - voice_raven       (Node wrapper + Python child for Raven core)
  - agent_runtime     (Node.js, supervises agent subprocesses)
  - host_notifications, host_shell, scheduler_cron (Node.js)

Agent subprocesses (spawned by agent_runtime, each registers as agent.{id}):
  - Claude Agent SDK or Claude Code CLI per agent, ledger volume bind-mounted from ~/Aether/agents/{id}/
```

**Data flow (worked example — "morning brief").**

1. `scheduler_cron` fires at 06:30 → `invoke agent.morning_brief.inbox payload={trigger: cron}`.
2. The agent's runtime delivers via SSE → cell engine assembles system prompt from ledger.
3. Cell invokes `news_feeds.recent {since: yesterday, urgency_min: 3}` → returns articles.
4. Cell invokes `finance_quotes.latest {symbols: <watchlist>}` → returns quotes.
5. Cell invokes `ai_claude.complete {prompt: <summary template>, context: …}` → returns brief.
6. Cell writes `~/Aether/data/workspaces/briefs/2026-05-12.md` via filesystem.
7. Cell invokes `host_notifications.notify_urgent {title: "Morning brief ready"}`.
8. User opens VIEWER → `markdown-editor` app shows the brief; the `news` app already has the urgency-scored feed; the `finance` app shows pre-market quotes.

**Extension points.**
- *New tool-module* → new directory under `nodes/`, declared in `manifest.yaml`. No Core change.
- *New UI* → new directory under `shell/src/apps/`, auto-discovered. Optionally consumes a mesh node.
- *New agent skill* → file under `~/Aether/agents/{id}/skills/{name}/SKILL.md`. Agent reads it dynamically.
- *Grant a permission* → add an edge to `manifest.yaml`. Reload via `core.reload_manifest`.

---

## 6. Concrete next steps (proposed roadmap for Opus to refine)

Strict ordering matters: each phase unblocks the next.

**Phase 0 — Hardening & port.** Vendor RAVEN_MESH `core/` + `node_sdk/`. Port the SDK
to TypeScript (`node_sdk_ts/`) — it's a 3-call protocol (`register` + SSE consume +
`invoke/respond`); ~200 LOC. Fix the NEXUS CRITICAL audit findings in any code we
plan to lift (path traversal, auth, atomic writes).

**Phase 1 — Skeleton up.** Get Core + one trivial node (`host_notifications`) + Shell
(VIEWER stripped of NEXUS/Raven for now) running end-to-end. Renderer button → IPC
→ mesh invoke → notification. Cross this bridge and the rest is filling in nodes.

**Phase 2 — Lift Pulse modules as nodes.** One per week, in this order: `news_feeds`,
`finance_quotes`, `knowledge_lookup`, `finance_earnings`, `finance_sec`, `sports_live`.
Each comes with its existing Pulse renderer component re-housed as a VIEWER app.

**Phase 3 — Agent runtime.** Bring up `agent_runtime` + `orchestrator`. First-class
NEXUS dashboard inside VIEWER as the `agent-manager` app. Single agent end-to-end:
create → inbox via mesh → ledger on disk → response published. *No team features yet.*

**Phase 4 — Voice.** Port VIEWER's raven-daemon into `voice_raven` node. Raven's
tools become mesh edges into existing nodes.

**Phase 5 — Teams, mailbox, boards, cron.** All ex-NEXUS, now expressed as mesh
nodes + edges. Mailbox = inbox surface; boards = files; cron = `scheduler_cron`.

**Phase 6 — AI router.** `ai.*` nodes finalized. Voice → Gemini Live (live audio);
fast text/HTML → Cerebras; deep → Claude; local → Ollama; vision → Gemini. Single
tool selection rule: lowest-latency provider permitted by the calling agent's edges.

**Phase 7 — Polish.** Holographic theme system-wide. Splash/boot orchestration like
Pulse. Power/idle/suspend respect in every scheduler. macOS packaging (electron-
builder, signing, notarization). Auto-update.

---

## 7. Open questions for Opus

The decisions below depend on judgment or user input I don't have. Listed so the
synthesis can be sharpened before code is written.

1. **Process model for agents.** Docker (NEXUS shape, hardened) vs. `sandbox-exec` macOS native vs. plain subprocess. Trade-off: isolation strength vs. cold-start vs. file-tree transparency. Recommendation in §4.3 is native, but if Aether will ever run untrusted agents, Docker may win back.
2. **Mesh-everywhere vs. mesh-between-processes.** §4.1's (a) vs. (b). The latter is recommended but adds a "render-side mesh client" question for apps that need direct mesh subscriptions.
3. **Manifest authority.** YAML on disk (RAVEN_MESH today) vs. a SQLite-backed runtime manifest. YAML is the SPEC; SQLite would make user edits via UI cleaner. Resolution: keep YAML as canonical, generate from SQLite on `core.reload_manifest`.
4. **Renderer SDK ergonomics.** Should the VIEWER app context expose `mesh.invoke('news_feeds.recent', …)` directly, or only domain wrappers (`news.recent(…)`)? Direct is simpler; wrappers give typed surfaces. Likely both, with wrappers code-generated from the manifest's JSON Schemas.
5. **Where does the user identity live?** Today none of the four repos have one — all single-user. Aether may stay single-user, or may want a "user" node so multi-machine sync (one day) is a mesh edge, not a rewrite.
6. **Secret storage.** RAVEN_MESH uses env vars + manifest `env:VAR` indirection. macOS Keychain is the obvious upgrade — NEXUS partially does this for OAuth tokens (`oauthSync.ts`). Recommendation: every `identity_secret` resolves through Keychain by default, env-var as fallback.
7. **Per-agent vs. global skill libraries.** NEXUS today gives each agent its own `skills/` dir. Pulse-style services don't have a skill concept. Aether may want a *shared* skill store (read-only across agents) plus per-agent overrides.
8. **Pulse's Python workers (Kokoro TTS, SDXL reels).** Heavyweight optional features. Worth porting now (as nodes) or deferred to Phase 7+?
9. **Backup / sync story.** Mesh is local-first by design. If/when the user wants iCloud-backed `~/Aether/`, what's the boundary? `data/Aether.db` and `agents/` are the load-bearing dirs; `.mesh/audit.log` rotates.
10. **CLAUDE.md handoff.** The user mentioned an Opus-authored `CLAUDE.md` for the Aether repo is coming. This document is the *substrate* — `CLAUDE.md` should be the *operating instructions* (how to run, how to add a node, where the splash is, what the holographic theme variables are, the four "don't do this" gotchas from §1.1).

---

## 8. TL;DR for Opus

- **Pulse = the engine room.** Lift its ~50 services as mesh nodes; keep its scheduling intelligence intact inside each.
- **RAVEN_MESH = the spine.** Adopt the protocol unchanged. The edge-graph authorization model is the missing piece NEXUS never had.
- **NEXUS = the agent runtime + dashboard.** Lift the *concepts* (ledger, mailbox, runs, teams, MCP-callback). Rewrite the transport on top of mesh. **Fix all CRITICAL items in `_ingest/NEXUS/AUDIT.md` before reusing any code.**
- **VIEWER = the surface.** Adopt the app-discovery pattern, the daemon-manager pattern, and the command palette. Fold NEXUS's dashboard into VIEWER as the `agent-manager` app. Pulse's renderer components become VIEWER apps with `fileApi` + mesh-node-of-record.
- **The product:** every "Iron Man tool" is one mesh node (data engine) + one VIEWER app (the glass) + one or more edges (the permissions). Adding a tool = adding two directories and one line of YAML.
