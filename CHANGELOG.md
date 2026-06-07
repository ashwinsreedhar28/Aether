# Changelog

All notable changes to Aether (working name homeOS through v0.3.x) are
documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning per
CLAUDE.md §6 (honest pre-1.0 scheme). Entries dated before the rename PR
refer to the project by its working name; they are preserved verbatim as
historical record.

## [Unreleased]

### Added
- Calendar weekly view — a fourth calendar surface and voice tool. New
  `calendar.get_week {date}` surface on `nodes/calendar` returns every event in
  the 7-day window `[date, date + 7 days)`, sorted by start time (the node stays
  date-agnostic: it returns seven days from whatever date it is handed and
  imposes no week boundary; `date` omitted = the next seven days). New
  `calendar_get_week(week='this'|'next'|'last')` voice tool answers "what's on my
  calendar this/next/last week" — because the voice model does not know today's
  date, the tool resolves the relative week to its Monday (ISO-8601 week start)
  on its own clock and hands the surface a concrete ISO date. `prompts.json` gains
  the tool entry + a worked example; `manifest.yaml` gains the surface and the
  `raven → calendar.get_week` edge. (Issue #193.)
- The Atlas (`docs/atlas/`) — Aether's living visual architecture map.
  `architecture.html` is one self-contained dark-theme page covering process
  topology, the signed mesh (19 nodes, 69 edges, 40 surfaces — counts parsed
  from `manifest.yaml`), the voice pipeline (Gemini Live → tools → mesh → spoken
  + panels; 41 live voice functions), the `$userData` data layer, the four
  cockpit views, the self-building loop (rung 2 in-flight; the `aether-rag` MCP
  server shown as landed per #187), and a ports/processes quick-reference. Every
  count cites the source it was read from; doc-vs-code disagreements are recorded
  in an Appendix rather than smoothed over (the scene-protocol precedent).
  `docs/atlas/README.md` indexes it and the three frozen `history/` snapshots;
  the living map is re-snapshotted into `history/` at each release cut. Linked
  from `README.md` and `docs/README.md`.
- Precedent-first implementers + the rebase playbook — recipe wiring for the
  self-building loop. CLAUDE.md gains two standing rules: **§13.13
  Precedent-First Implementers** (the default discovery mode is to query the
  `aether-rag` MCP `search_corpus` for relevant decisions/patterns before each
  build step, replacing exhaustive hand-fed file lists; hand-named precedents
  remain only for *load-bearing* reads — wire formats, choke-file regions,
  pattern-lift sources — and the index can only retrieve law that's *written*)
  and **§13.14 Open-Own-Issue Default** (a lane without a supplied issue opens
  its own and proceeds, instead of round-tripping the Director). The `draft_lane`
  tool bakes a fixed **PRECEDENT** composer line into every machine-drafted
  prompt, right after RECON-FIRST, routing the spawned implementer to
  `search_corpus` before each step. New **`docs/rebase-playbook.md`** writes down
  the rebase oral law — CHANGELOG keep-all, `prompts.json`/`manifest.yaml`
  keep-both-distinct-sections, recount-don't-inherit for shared scalars,
  force-push-with-lease, smoke-then-rebase ordering, re-verify post-rebase — and
  is added to the RAG `CORPUS_GLOBS` so it is actually retrievable (closing the
  eval's Q1 *"how do we resolve CHANGELOG conflicts"* corpus gap). Linked from
  CLAUDE.md §13.13 and the `docs/README.md` index. Docs/process + one composer
  line + one corpus-glob entry; no wire-contract or runtime-behavior change.
- RAG MCP server — `daemons/aether-rag/server.py` wraps the spike's retrieval core
  (`rag_lib.search`) as a **stdio MCP server** so every Claude Code session opened in
  this repo inherits the corpus as a tool. One read-only tool, `search_corpus(query,
  k=5, source_filter=None)`, returns scored passages with source path, heading
  breadcrumb, and line span; `source_filter` is a case-insensitive substring on the
  source path to scope a search to one file or tree. No reindex tool and no write
  surface — building the index stays the human-run `reindex.sh`, and a missing index
  yields an instructive error rather than an auto-build (predictable startup over
  magic). Registered project-scoped in a committed `.mcp.json` at the repo root (paths
  via `${CLAUDE_PROJECT_DIR:-.}` so worktrees resolve); `mcp==1.27.2` pinned in
  `requirements.txt`. Approve once via `/mcp`, verify with `claude mcp list`.
- The spawn actor (rung 2 of the Architect arc) — Aether can spawn its own
  Implementers, human-gated by construction. New `request_spawn(draft, passphrase)`
  voice tool (raven-core): arms a spawn only on a spoken passphrase checked
  constant-time against `AETHER_SPAWN_PHRASE`, then appends a `requested` line to
  the append-only ledger `$AETHER_DATA_DIR/spawns/requests.jsonl` (raven-side
  write, no mesh edge — same shape as `draft_lane`). The shell's new `SpawnService`
  watches the ledger and raises a global **approval card** (full prompt preview,
  target branch/worktree, Approve / Dismiss); on approval it runs the CLAUDE.md
  §13.12 worktree recipe (`git fetch` → `worktree add` → submodules → copy
  `.env.local` → `pnpm install` → write `LANE.md`) and launches a **visible
  Terminal.app** window running Claude Code against the lane. Concurrency is capped
  at one live spawn; closing the spawned Terminal is the kill switch. The Lanes
  view gains a **Spawns strip** reading the ledger
  (requested/spawned/closed/dismissed/failed). The spawn passphrase is scrubbed to
  `[REDACTED]` from persisted transcripts (and the live ring) so it is
  unretrievable from the eventual RAG corpus. Merge authority is untouched — the
  tool only *requests*; the Director *approves*. `prompts.json` gains tool #21 +
  instruction + example; `AETHER_SPAWN_PHRASE` is passed through
  `ravenDaemonManager`.
- RAG core spike under `daemons/aether-rag/` — standalone retrieval over Aether's
  own corpus (governance log, DECISIONS, CHANGELOG, CLAUDE.md, scene protocol,
  release notes, READMEs, manifest). Locked stack: `fastembed` (ONNX, no torch,
  `bge-small-en-v1.5`) + `sqlite-vec`. Heading-aware chunking (`##`/`###` sections,
  oversize windows with overlap, per-node manifest chunks); `indexer.py`,
  `query.py` CLI (honest cosine-similarity scores), `eval.py` (six canned gate
  questions, human-judged — no auto-grading), `reindex.sh`. No mesh, no MCP, no
  imports from repo code — a quality probe before any MCP wrapping. Index lives at
  `daemons/aether-rag/.rag/index.db` (gitignored derived artifact).
- Repo front v2 — README rewritten to describe what Aether is *today* (a voice-first
  personal-OS substrate: signed mesh, `raven` voice brain, scene cockpit, and the
  human-gated self-building loop `gaps → proposals → drafts`), with an honest
  quickstart verified against the workspace scripts (`pnpm install && pnpm -r build`,
  then `pnpm dev` from `shell/`), an ASCII architecture sketch, and a documentation
  index. Cuts the `[Unreleased]` backlog into the dated `[0.10.0]` section below (see
  its provenance note). Adds `docs/README.md` (documentation index) and
  `docs/releases/v0.10.0.md` (release narrative). Sets GitHub repo topics.

### Changed
- CLAUDE.md diet — the operating core trimmed from 42,603 to 29,752 chars (~30%),
  back under Claude Code's 40k performance threshold that every Implementer session
  paid on first read. Zero section renumbering and zero meaning lost: every `§N` /
  `§N.M` keeps its meaning, and the reference bodies (long worked examples, historical
  PR lists, the six-shape manual-completion history, templates, the glossary, and
  extended rationale) **relocate** verbatim to a new `docs/claude-reference.md` whose
  `§` anchors match CLAUDE.md — each slimmed section keeps its rule plus a one-line
  pointer. Operating law (gates, the §13 discipline, the §7 template, the §11
  heuristics) stays in CLAUDE.md. The new doc is added to the `aether-rag`
  `CORPUS_GLOBS` (`daemons/aether-rag/rag_lib.py`) so the moved text stays
  retrievable via `search_corpus`, and indexed in `docs/README.md`. (Issue #195.)

### Fixed

### Removed
- Stray `scratch-test.txt` from the repo root (empty placeholder; Architect-authorized
  cleanup as part of the repo-front-v2 lane).

## [0.10.0] - 2026-06-04

*Provenance note: per-version CHANGELOG sectioning lapsed after `[0.0.3]` — the tags
`v0.1.0` through `v0.9.4` were cut without matching sections, so the entries below
aggregate the entire `v0.1.0 → v0.10.0` arc rather than only the latest tag's work.
The v0.10.0 cut dropped and reordered nothing: only this heading changed (it was
`[Unreleased]`). Reconstructing per-tag sections from the tag history is deferred to
a follow-up lane. For the v0.10.0 release narrative, see
[docs/releases/v0.10.0.md](docs/releases/v0.10.0.md).*

### Added
- Scene panel protocol contract (`docs/scene-protocol.md`, "Contract v1") — the
  AVP-track wire interface written down so the collaborator builds the 3D
  renderer against a document, not against our source. Documents the scene
  server's endpoints as implemented (`GET /scene`, `POST /scene/panel[/{id}]`,
  the whole-doc `PUT`/`PATCH`, deletes, the entity mirror, and `WS /scene/stream`),
  panel anatomy (fields, the 8-value `kind` enum vs. the 3 the 2D shell renders,
  create-vs-merge semantics, the string-only `style` constraint, ordering),
  lifecycle (summon → POST → broadcast → render, snapshot/delta frame shapes,
  reconnect, no-op-writes-emit-no-delta, what consumers may not assume), real
  producer payloads (`dashboard.*` backdrops + `viz-*`/`cli-*` overlays), and a
  versioning rule (breaking wire changes bump the contract and ping the AVP
  owner). Includes an "observed discrepancies" appendix recording six
  doc-vs-code / doc-vs-doc mismatches found while writing it (none fixed — docs
  lane). Cross-linked from the README architecture section. No code changes.
- Stale-dist boot guard for the TS mesh nodes. At shell boot, as each TS node is
  about to spawn, `NodeManager.spawnNode` now calls a new
  `shell/electron/main/services/staleDist.ts` helper that compares the newest
  file mtime under the node's `src/` against its `dist/` build output; if `src/`
  is newer it logs a LOUD warning naming the node
  (`[guard] nodes/visualizer dist older than src — run pnpm -r build`). Catches
  the install-≠-build trap where `pnpm install` (or a branch switch touching a
  node's source) leaves the shell silently spawning stale compiled code off an
  otherwise "fresh main" (the TS-node sibling of PR #168's stale-daemon finding;
  Python nodes run from source and have no dist/ to drift). Warn-only v1 — a
  cheap mtime walk with no hashing and zero new deps; it never auto-builds and
  never blocks the spawn. Because the check sits in the shared `spawnNode` path,
  every current and future TS node is covered automatically.
- Day-2 bank — banks the 2026-06-04 "self-building day" lessons in
  `docs/governance-log.md`: six entries covering the stale family completed
  (stale runtime / stale detached daemon — raven's `_discover_tool_modules`
  runs once at spawn so an orphan serves the old tool set, #168 / stale dist —
  install ≠ build, TS runs compiled while python runs from source; "fresh"
  proven at every layer the change rides), calibrate-the-oracle (a smoke's
  external ground truth — e.g. Calendar.app's timezone — is part of the test
  rig; verify the instrument before trusting the failure, #170's false
  negative), recount-don't-inherit (parallel editors of one scalar — the tool
  count — re-derive it from ground truth at merge, never adopt either branch's
  value, #168), the recon-first guardrail (a fixed template line makes thin
  machine-drafted specs self-limiting — recon and STOP at uncovered decisions,
  rung 1), rung-1 expectations set (live-session drafts are fireable starts for
  simple lanes, guarded skeletons for hard ones; depth is model-bounded; rung
  1.5 offline-model composition banked), and routing-is-runtime-behavior (a
  declared tool isn't a called tool — instruction strength earns the call in
  the live session, not the harness). Docs-only.
- Architect rung 1 — accepted proposals become paste-ready lane prompts on disk.
  A new `draft_lane` voice tool
  (`daemons/raven-core/raven_core/tools/draft_lane_tool.py`) takes ONE accepted
  build proposal (name, goal, scope_files, steps, smoke — supplied by RAVEN from
  the proposal it just pitched via `review_gaps`) and deterministically composes a
  **house-format lane prompt** (`=== LANE … ===` fences, role line, a fixed
  RECON-FIRST guardrail line — read the named precedents and STOP to report options
  if a design decision isn't covered, so thin drafts are self-limiting rather than
  freelanced — branch/worktree placeholders, GOAL, SCOPE, numbered BUILD STEPS,
  Director-run smoke, the verify-then-ship Ship line, a PR title), then writes it to
  `<root>/architect/drafts/<slug>-<ts>.md`. The write is **direct to disk** — a
  raven-local artifact, not mesh data — so there is **no mesh hop and no manifest
  change** (see DECISIONS.md). To resolve the canonical `$AETHER_DATA_DIR` path,
  `ravenDaemonManager.ts` now passes `AETHER_DATA_DIR: nodeDataDir()` into the raven
  daemon env — the **same shared `$userData/data` root every mesh node gets** — so
  drafts land at `$userData/data/architect/drafts/`, a sibling of the per-node data
  dirs. The tool resolves its root by precedence `AETHER_DATA_DIR` → `RAVEN_USER_DIR`
  → `~/.raven` (mirroring the memory store) so it still runs standalone. Like
  `report_gap`/`notify` it is a SIDE-EFFECT tool — it returns only `{ ok, path }`;
  the voice prompt routes "draft it / write the lane for X" to call `draft_lane` and
  speak exactly ONE line ("Drafted, sir — in architect drafts."), never reading the
  prompt, path, or steps aloud. `prompts.json` gains tool 19, a Proposing-section
  extension with a **HARD ROUTING RULE** (accept-verbs — "draft it", "write the lane
  for X" — must call `draft_lane` on the same turn; RAVEN never defers, never says a
  draft "will be added", and never routes an accept to `report_gap` as if it were a
  missing capability), one rich worked example, and a function description. Reaches
  `draft_lane_tool.py` + `prompts.json` +
  `shell/electron/main/services/ravenDaemonManager.ts` (one env line + import).
- Scene arrangement v1 — the Scene column is now arrangeable. Each card carries a
  subtle six-dot grip in its header (§15 restraint — no heavy drag chrome); drag
  it to reorder panels, with a single accent insertion line marking where the
  panel will land. The order is per panel id and **survives restarts**: a small
  `scene:get-order` / `scene:set-order` IPC pair persists the id sequence to
  `scene-order.json` under userData (atomic tmp+rename write; a missing or
  corrupt file degrades to today's server arrival order). Panels new since the
  last save take the default placement (appended in arrival order). #149's
  re-summon pulse + scroll-into-view still fire in place on a reordered card —
  the list stays keyed by panel id — and dashboard backdrop refreshes still
  don't pulse.
- Gap **lifecycle** — gaps are now `open` or `closed`, so the ledger reflects
  what's been answered, not just what was ever missing. The `intents` node gains
  a new actor surface **`intents.close { id | match }`**: `match` closes every
  OPEN gap whose text contains a case-insensitive substring (so "the email one
  is done" closes both mail gaps in one call), `id` closes one. Closing is
  **event-sourced and append-only** — `close` appends a `{ id, ts, closed:true }`
  event rather than rewriting the JSONL, so the same `fsync` durability that
  protects a recorded gap protects a closure; current state is derived by folding
  the log forward. **`intents.list`** gains a `status?` filter (`open` |
  `closed` | `all`, **default `open`**) and now returns whole-log
  `counts: { open, closed }` alongside the (filtered) gaps. Existing gap lines
  without a `status` field migrate to `open` on read. RAVEN's new **`close_gap`**
  voice tool routes "mark that closed" / "you can read mail now" to
  `intents.close` (manifest edge **`raven → intents.close`**), confirming briefly
  from the returned count; `review_gaps` now pulls **open** gaps only, so
  "what should we build next" stops re-pitching capabilities already built. The
  visualizer `gaps` overlay shows **open** gaps with a lifecycle header
  ("2 open · 3 closed").
- Mesh topology — **edges are now inspectable, not just drawn.** Hovering an
  edge highlights it (its two endpoints stay lit, all other edges dim) and shows
  the surface it authorizes as a small inline label at the curve's midpoint
  (`to.surface`, `+N` when the pair bundles several). Clicking an edge opens the
  detail panel on the **relationship**: every authorized `from → to.surface`
  plus both endpoints' live status, with each endpoint clickable to jump back to
  the node. A node's **EDGES IN / EDGES OUT** rows became clickable too — each
  selects that edge — closing the node → edge → node navigation loop. Killing a
  node updates the selected edge's endpoint status live (the selection only
  drops if an endpoint leaves the topology). Renderer-only (`MeshView.tsx`); the
  edges already exist in the manifest. Degrade/empty states unchanged.
- Calendar agenda by voice + panel — "show me my agenda." The calendar voice
  path was already wired end-to-end (the `calendar` node's `today` / `upcoming` /
  `next_event` surfaces, the `calendar_today` / `calendar_next` /
  `calendar_upcoming` tools, and the `raven → calendar.*` edges all shipped in the
  Sprint 2 data-breadth lane), so this lane added only the two missing pieces: a
  **viz-agenda panel** and the **prompt wiring**. The visualizer Mixer grows an
  `agenda` intent: it reads `calendar.today` (today's full day) and
  `calendar.upcoming` (the window it carves *tomorrow* out of by local date),
  composes a single time-ordered markdown overlay (`viz-agenda`) with **Today**
  and **Tomorrow** sections, and POSTs it to the scene server — same
  read-compose-POST pattern as the mesh/lanes/gaps overlays, with each calendar
  read independently resilient (a failed read renders that section "unavailable"
  rather than failing the whole summon). Two new manifest edges
  (`visualizer → calendar.today`, `visualizer → calendar.upcoming`) authorize the
  reads; raven's existing `raven → visualizer.render` edge already covers the
  voice summons. `prompts.json` gains a **Calendar & agenda** section: a spoken
  agenda ask ("what's on my calendar today") answers concisely — count + soonest
  event — and offers the panel, while "show me my agenda" summons
  `visualize({ intent: 'agenda' })` and speaks only a brief acknowledgment. The
  `calendar` node and voice tools are unchanged. Reaches across the visualizer
  node (`types.ts` + `templates.ts` + `index.ts`), `manifest.yaml`,
  `nodes/visualizer/schemas/render.json`, and `prompts.json`.
  - **Event times are always local.** The agenda panel renders each event's
    wall-clock by parsing the node's local-naive ISO stamp **literally**
    (`parseLocalIso` — no `new Date()`), so the displayed time can't be shifted
    by however the daemon's JS engine guesses a timezone for an offset-less
    string. This matches the voice tool's `strftime` and Calendar.app's default
    (system-local) display — a 4:30 PM Eastern meeting reads as 1:30 PM on a
    Pacific machine, i.e. when it actually lands in the user's day. (The node
    keeps its existing `datetime.fromtimestamp()` system-local conversion; an
    event's own authored timezone is deliberately not honoured.)
- Mail — "pull up my latest email." Closes the gap sensor's first recorded
  capture ("mail surface exposes sender and subject only, no body"), but by
  **opening the message** rather than narrating it (Architect §14.1 pivot — see
  DECISIONS.md). New actor surface **`macos_mail.open_message {id}`** opens a
  message in Mail.app via the `message://<rfc-message-id>` URL through
  **LaunchServices** (`open` CLI, deliberately NOT AppleScript — verified 0.06s
  the same night AppleScript reads were timing out at 30–120s). The stored uid
  is already the RFC Message-ID, exactly what the `message:` scheme matches.
  RAVEN's new `mail_open_latest` tool + the voice prompt route "read / show /
  open / pull up my latest email" to: speak **one line** (sender + subject, plus
  a short gist only if a body was captured) **and** bring Mail.app to the
  message — full bodies are never narrated. `manifest.yaml` declares the surface
  and the `raven → macos_mail.open_message` edge (authorized scope amendment).
  Body capture stays in the node, **non-blocking**: it bulk-reads recent headers
  (one Apple Event per property — ~6 events, not the ~100 a per-message loop
  issues and which blew the 30s timeout under Mail's variable latency), then
  backfills each message's plain-text body (`content of msg`, whitespace-
  normalized, ~1500-char cap, `bodyTruncated` flag) for the newest few over
  later ticks with a `body_attempts` retry cap (SQLite schema → v3); bodies feed
  the gist and future summaries when Mail recovers. Poll/body health (last
  status, failure count, last error, timestamps) is written to a `mail_meta`
  table so a stall is diagnosable via `SELECT * FROM mail_meta` (e.g.
  `last_header_status = timeout`) instead of a silent `47|0|0`. The freed
  `report_gap` worked example is replaced with a still-true gap ("dim the
  lights" / no home-control surface) rather than deleted. Reaches across node +
  `mail_tool.py` + `prompts.json` + `manifest.yaml`.
- Architect v0 — Aether proposes its own next builds. A new `review_gaps` voice
  tool (`daemons/raven-core/.../tools/review_gaps_tool.py`) reads the recorded
  gap log back through the mesh (`intents.list`, newest ~50) and hands raven the
  gaps as CONTENT to reason over — the read-side counterpart to `report_gap`'s
  write. When the user asks "what should we build next" / "propose improvements"
  / "review your gaps and suggest something", raven clusters related gaps and
  pitches 1–3 concrete lanes, each named with the gap(s) it closes and what it
  would touch (node / tool / prompt / view), spoken and brief. It PROPOSES only —
  building stays human-gated; raven never offers to build, spawn, or schedule.
  manifest gains the `raven → intents.list` read edge (raven could already WRITE
  gaps via `raven → intents.record`; reading is a new relationship, and every
  consumer needs its own edge — #136's lesson, restated). `prompts.json` bumps
  the tool count to eighteen, adds a "Proposing next builds" instruction section
  kept distinct from the `report_gap` (records a gap) and `visualize` gaps
  (displays the log) sections, plus a worked example. First brick of the
  Architect era.
- Encore bank — banks the 2026-06-03 (night) "encore" mail-RCA lessons in
  `docs/governance-log.md`: five entries covering measure-don't-reason (per-call
  wall-clock is timed, never inferred from payload size — two Architect estimates
  corrected by an 84s/~28s-per-call measurement), a-signal-nobody-can-see-isn't-a-
  signal (failure counters must land in a DB/status surface, not terminal-less
  stdout — the `mail_meta` precedent), the stale-runtime confound (a probe is only
  valid against a process launched after the build it tests — runtime cousin of
  smoke-the-bits-you-ship), the honest hold (ship with the gap stated and HOLD the
  merge until observed green per #154 — never manufacture a pass, never write
  synthetic data into real user stores), and environmental-degradation-is-a-finding
  (Mail.app AppleScript latency documented + an Envelope-Index alternative banked in
  an ADR with a 48h trigger). Notes the §13.10 "shape 6" graduation of the hand-edit
  hotfix remains parked — out of scope for a docs-only lane that doesn't touch
  CLAUDE.md. Docs-only.
- Re-summon attention affordance — when a summon refreshes a Scene panel that is
  already on screen (e.g. saying "show me the mesh" a second time updates the
  `viz-mesh` overlay in place), the card now acknowledges it: a restrained ~1.5s
  accent box-shadow pulse (one ease-out swell, no bounce/flash per §15) plus a
  `scrollIntoView({ block: 'nearest' })` that brings it back into view only if
  it had scrolled off-screen. SceneView tracks a per-id pulse nonce in a reducer
  and bumps it whenever a delta updates an already-rendered panel; brand-new
  panels (appends) keep their plain entry behavior, and `dashboard.*` backdrop
  panels — re-POSTed on the visualizer's poll loop, not summoned — are excluded
  from the affordance. Respects `prefers-reduced-motion`. Renderer-only.
- Gap visibility — the gap log becomes a panel. The `visualizer` Mixer gains a
  fourth intent, `gaps`: it reads the gap sensor (`intents.list`, newest ~20)
  through the mesh and composes a `viz-gaps` summoned overlay listing what Aether
  couldn't do — timestamp + gap text per line, count in the header, newest-first.
  Resilient like the `lanes` overlay: an empty log renders "No recorded gaps" and
  a down gap sensor renders "gap sensor unavailable" rather than failing the
  summon (the read-failure path posts the unavailable panel and still returns
  ok). manifest gains the `visualizer → intents.list` edge — the `shell →
  intents.list` pre-grant from the gap-sensor PR does NOT cover the visualizer;
  every consumer needs its own edge (#136's lesson). raven's prompt
  (`prompts.json`) routes "what are your gaps" / "show me your gaps" / "what
  can't you do yet" to `visualize({ intent: 'gaps' })`, kept explicitly distinct
  from `report_gap` (which RECORDS a gap) and from `navigate` (the verb split is
  preserved). Voice-summonable like mesh/lanes — brief ack, panel never read
  aloud. (Visualizer README's intent list and the `lanes` intent it had been
  missing are documented in the same pass.)
- Chats persistence — durable transcripts + Chats view. Conversations now
  survive restarts. The raven-daemon persists every transcript entry as JSONL
  (one file per session under `<userData>/raven/transcripts/`), keying each
  entry to a `sessionId` minted per child spawn; the in-memory ring stays the
  hot path and is seeded from disk on boot, so `GET /transcripts?limit=N` serves
  cross-session history immediately. Typed turns — which raven-core never
  transcribes (no audio) — now get a synthesized `user` transcript at
  `/text`-accept, so they ride the same persisted/ringed/pushed stream as spoken
  turns; the CLI consequently drops its optimistic echo and renders that one
  push (no double line). The shell exposes `voice.getTranscripts({limit})`
  (preload + a `voice:get-transcripts` IPC) that does not gate on mic
  availability — history shows whenever the daemon is reachable, empty list
  otherwise. The Chats tab's placeholder becomes a Claude-web-style view
  (LanesView idiom): a left sidebar of past sessions (newest first, the current
  one badged LIVE) and a detail pane showing the selected session's
  conversation — you/aether aligned chat bubbles in the CLI's monospace
  aesthetic, `system` lines as centered notes, newest at the bottom, near-bottom
  autoscroll. It defaults to the live session and live-appends there over the
  existing `onTranscript` push; the live session is learned from live pushes
  (not loaded history) so a reboot never mislabels the previous session as live.
  On the Chats view the global CLI's echo log is hidden (the conversation IS the
  transcript there) while its input stays — a `showEcho` prop on `Cli`, gated by
  the Shell's active view, not a fork. No mesh/manifest/prompts changes —
  transcripts ride the existing daemon transport.
- Chats hardening — transcript cap + exact LIVE badging. Closes the two
  deferrals flagged in the Chats-persistence PR (#147). (1) The raven-daemon now
  bounds the transcripts dir: on boot and on each new session it prunes the
  oldest session files beyond a cap (default 50, override
  `RAVEN_TRANSCRIPT_MAX_SESSIONS`), never deleting the live session. We cap by
  file count, not bytes — one file per child spawn is the realistic growth
  vector, so a count cap bounds it predictably (a byte cap is a later lane).
  (2) `GET /status` now carries the live `sessionId` (set only while a child is
  listening), surfaced through the shell's `voice.status()`; the Chats view reads
  it on mount and badges the live session LIVE immediately — including when the
  user opens Chats mid-session — instead of waiting for the first transcript
  push. Push-based detection stays as the fallback when `/status` is unreachable.
  Daemon + shell only; no mesh/manifest/prompts changes.
- Gap sensor — Aether notices what it can't do. A new `report_gap` voice tool
  (raven-core's seventeenth) fires whenever raven hits a request no tool,
  surface, or data covers: it records a one-line description of the missing
  capability and declines to the user naturally in the same breath, never
  announcing that it logged anything. The gap is persisted as **mesh data** by a
  new `intents` node — the mesh's first node whose stored state is
  mesh-authored rather than a re-fetchable cache of an external source. The node
  exposes `intents.record { text, context? } → { ok, id }` (append + `fsync` to
  an append-only JSONL log at `$AETHER_DATA_DIR/intents/gaps.jsonl`, so a crash
  right after the ack can't lose the gap) and `intents.list { limit? } → { gaps }`
  newest-first. Manifest edges: `raven → intents.record` (the write path) and a
  deliberate pre-grant `shell → intents.list` for the named-next gap-visibility
  view (every renderer consumer needs its edge first — #136's lesson). raven's
  prompt teaches the gap/empty-result boundary: an existing tool returning empty
  or erroring is coverage, not a gap. First brick of the self-building arc.
- Lanes agent detection — live CC sessions per worktree. The `lanes` sensor now
  reports a per-lane `agent: { active, count } | null` alongside the existing
  file-mtime `state`, distinguishing "an agent is working this lane right now"
  from "branch idle". Detection is one `lsof -a -c claude -d cwd -Fpn` call per
  10s git tick (the only macOS way to read a process cwd; ~25ms, rides the
  synchronous git poll) that matches the cwd of every live `claude` process to
  the worktree it sits in (or under, with a sibling-prefix guard). `agent` is
  `null` when detection is unavailable (lsof missing/errored) — deliberately
  distinct from `{ active: false, count: 0 }` ("detected, none here"); note
  `lsof` exits 1 on zero matches, which the node treats as "none", not an error.
  Field rides the existing `lanes.status` payload (no manifest change). The
  Lanes view gains a glowing accent `AGENT` badge on active lanes in the sidebar
  and an `AGENT` row in the detail pane, both degrading to "—" when the signal
  is absent. Node + renderer only; no manifest, daemon, or transport change.
- Mesh graph view — interactive topology. The Mesh tab's stub becomes a
  renderer-native graph (React + hand-rolled SVG; no new deps, no d3) fed by
  `mesh_introspection.topology`, polled ~10s while mounted with a manual
  refresh (LanesView's pattern). Layout is deterministic and banded by category
  (SPINE = core+raven+shell, then Mixer / Sensor / Actor), sorted by id within
  each band, drawn in a fixed viewBox that scales to the window — positions are
  a pure function of the node set, so refreshes never jitter. Edges are curved
  SVG paths under the nodes. Clicking a node opens a side detail panel (status,
  category, description, surfaces, edges in/out by name); click-away or Esc
  closes it. Hovering (or selecting) a node highlights its edges and dims the
  rest. Node status uses the cockpit's dot language — running (accent+glow) /
  stopped (muted), with one restrained amber for `unhealthy`; a killed node
  flips status within a poll cycle. `mesh_introspection` unreachable degrades to
  an "unavailable" state, never a crash. Renderer-only; no changes to main,
  preload, daemons, nodes, or manifest.
- Voice-driven view switching — a `navigate` voice tool flips the cockpit's
  active instrument view by spoken or typed command ("open my lanes", "go to
  the mesh", "switch to scene"). raven-core's thinnest side-effect tool: it
  validates the view name against the Shell's `{scene, chats, mesh, lanes}` set
  and returns `{ ok, view }` — **no mesh call, no new manifest edge**. The Shell
  reads the result off the existing `voice:tool-call` push (the same channel
  every tool already rides) and switches view; zero new transport. Kept
  deliberately distinct from `visualize`: "show me the mesh" still summons a
  panel overlay (visualize), while "go to the mesh" switches the whole view
  (navigate) — the voice prompt disambiguates by verb. Voice tool count
  fifteen → sixteen.
- Cockpit-day bank — banks the 2026-06-03 (evening) "cockpit day" lessons in
  `docs/governance-log.md`: six entries covering intent-over-mechanism spec
  discipline (four Architect-stated mechanisms corrected by Implementers reading
  code in #129–#134), smoke-the-bits-you-ship, new-path isolation smoking,
  pin-what-you-verify-behavior-against, every-consumer-needs-an-edge (the shell
  included), and the hand-edit hotfix shape (extends §13.10). Amends
  `docs/agent-platform-roadmap.md`: records the instrument-views arc (top bar +
  Lanes view #136; mesh graph view + voice navigation in flight) as a near-term
  lane that landed in flight, noting it pulls the ~Sprint 9 2D-spatial work
  forward in views form while the scene stays the ambient home; and names the
  next lanes (Chats persistence + Chats view, re-summon-focus polish, greeting
  re-enable). Docs-only.
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
- Mesh view — category is now a structural signal, not just a band label.
  Each node's **shape encodes its category** (Sensor → circle, Actor → rounded
  square, Mixer → hexagon, spine `core`/`raven`/`shell` → larger rounded rect),
  so category reads at a glance regardless of status. A **muted category hue**
  (Sensors teal, Actors coral, Mixers violet, spine accent-blue) tints the 1px
  node border on running nodes and the resting edge web (each edge inherits its
  *source* node's tint at low opacity). Fills stay neutral dark — no saturated
  fills — and status stays honest: `unhealthy` keeps its amber border, `stopped`
  keeps muted, and the running glow is unchanged. No new motion; labels, layout,
  and all #161 hover/selection/edge-click hit-paths are untouched (the focus
  accent still wins over the category tint). Renderer-only: `MeshView.tsx`.
- RAVEN voice prompt no longer hardcodes a tool *count*. The
  `voice_assistant.system_instruction` lead-in in
  `daemons/raven-core/raven_core/prompts/prompts.json` changed from "You have
  **twenty** tools available:" to "You have **the following** tools available:";
  the numbered 1–20 list itself is unchanged. The literal count had drifted
  repeatedly as tools were added (it was re-asserted by hand at every rebase, and
  was already inaccurate — calendar and mail tools are live but absent from the
  numbered list, so any single number undercounts the real registered set).
  Dropping the number is the smaller honest fix: a one-line wording change with
  zero loader plumbing, and "the following tools" cannot go stale. (Deriving and
  injecting a count at spawn was the alternative; rejected as both larger and
  still dishonest, since a derived total would not match the hand-maintained 1–20
  list either.)
- Chores — three governance/manifest debts in one lane. (1) **Honored the
  manifest schema's 280-char `metadata.description` bound**: trimmed the 14
  over-length node descriptions so the loader's JSON-Schema check passes clean
  on the `maxLength` rule (it had been silently unenforced). Pure prose
  compression — the dropped operational detail (poll cadences, dedup
  mechanics, file paths) already lives in each node's README. The one essential
  fact a compression would have lost — finance's Sprint 2 surfaces, including
  that `earnings` is a not-implemented stub — was relocated to
  `nodes/finance/README.md`, whose intro also stopped claiming "three surfaces"
  (the node exposes seven). (2) **`ship-it` skill co-author literal** corrected
  `Claude Opus 4.7` → `Claude Opus 4.8` to match repo convention (flagged in
  #149). (3) **Graduated the hand-edit hotfix to a formal `CLAUDE.md` §13.10
  shape 6** (Architect-dictated, Director-applied, isolation-smoked),
  fulfilling the graduation parked in the 2026-06-03 governance-log batch
  (#134). Docs/config + manifest prose only — no source-code or wire-contract
  changes.
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
- First-summoned Scene panels now scroll into view + pulse, not just re-summons.
  A never-seen panel arrives as an `add` delta and `applyOrder` appends unknown
  ids to the bottom, so a first summon could materialize below the fold while
  RAVEN announced it — with no scroll/pulse cue (the affordance fired only on
  `update` deltas to already-rendered panels). `reconcile` now reports EVERY
  summon-driven appearance — fresh append OR in-place refresh — in `summoned`
  (renamed from `resummoned`); the reducer bumps the panel's pulse nonce in the
  same transition that adds it, so the new card mounts at nonce 1 and its first
  render fires scroll-into-view + pulse. Dashboard.* backdrops stay excluded
  (their ~10s poll re-POSTs don't pulse), re-summons (#149) and drag-order
  persistence (#166) are unchanged. Renderer-only (`shell/src/dashboard/SceneView.tsx`).
- `macos_mail.recent` rejected the `unread_only` param RAVEN's `mail_recent`
  tool has always sent. The surface schema was `additionalProperties: false`
  with only `limit`/`since`, so Core's payload validation returned
  `denied_schema_invalid` (400) for every mail read and the tool surfaced it as
  "mesh unavailable". Drive-by found during the mail-body lane (the lane was in
  those files anyway): `unread_only` is now declared in the schema and honored
  by the node (filters `read_status = 0`).
- Text-injection ready gate fixed + `google-genai` pinned (retroactive — #134
  shipped in hotfix haste without a CHANGELOG line). Typed input racing session
  connect was buffered behind a ready flag the daemon set on `setup_complete`,
  but `setup_complete` never traverses raven's receive loop — so the gate never
  opened and the first typed turn could hang. The ready gate is now set **at
  connect** (when the session is live) rather than on a `setup_complete` that
  never arrives through the loop. Separately, `requirements.txt` left
  `google-genai` unpinned; per-worktree venvs had drifted (2.2.0 on main vs
  2.8.0 in a views worktree), so different worktrees validated different library
  versions — pinned `==2.2.0`. Shipped as an Architect-dictated, Director-applied
  hand-edit with an isolation smoke (typed-first, zero speech). Closes #134.
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
