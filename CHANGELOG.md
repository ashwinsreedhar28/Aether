# Changelog

All notable changes to Aether (working name homeOS through v0.3.x) are
documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning per
CLAUDE.md §6 (honest pre-1.0 scheme). Entries dated before the rename PR
refer to the project by its working name; they are preserved verbatim as
historical record.

## [Unreleased]


### Fixed

- **Weather + vision post-merge wiring gaps.** PRs #42 and #43 merged
  with incomplete wiring discovered during smoke test. Fixes:
  `shell/electron/main/services/paths.ts` now exports `WEATHER_ENTRY`;
  `shell/electron/main/services/nodeManager.ts` adds `spawnWeather()`
  (with `AETHER_DATA_DIR` extraEnv per the data-node pattern) and calls
  it in `startAll()`; `shell/electron/main/services/coreManager.ts`
  adds `MESH_VISION_SECRET` to the env block so Core agrees with
  visionDaemonManager on the vision secret value;
  `shell/electron/main/services/visionDaemonManager.ts` renames
  `VISION_SECRET` env var to `MESH_VISION_SECRET` (matches Aether
  convention); `nodes/vision/main.py` imports CoreVideo symbols via
  `Quartz.CoreVideo` (the pyobjc-framework-CoreVideo PyPI package
  doesn't exist; CoreVideo is bundled in `pyobjc-framework-Quartz`)
  and reads `MESH_VISION_SECRET` matching the convention.

- **`nodes/weather/schemas/`** — created missing schema files (`current.json`, `forecast.json`) that the manifest registered in PR #42 but were never actually written. Core failed to load with `FileNotFoundError` on launch. Hotfix completes PR #42's surface declarations.

### Added
- **CLAUDE.md §10 governance batch 2** — codifies ten Sprint 1 gotchas
  as new §10 subsections: mesh-node registration five-file pattern;
  GitHub Actions silently accepting unknown inputs; Claude GitHub App
  refusing to validate workflow changes against themselves; Python
  `try: except ImportError` blocks swallowing partial multi-import
  failures; `.env.local` loading inconsistent across raven-core / core
  / shell components; mesh SDK `Record<string, unknown>` requiring
  index signatures on strict surface return types;
  `pnpm --frozen-lockfile` failing when the worktree introduces a new
  package; `pnpm -r typecheck` depending on dependent packages'
  `dist/` already existing; ESLint `no-unused-vars` rejecting
  underscore-prefixed catch params under CI's locked versions; and
  Architect-authored spec drift from canonical ADRs. Each entry names
  the failure mode, where it surfaces, and the discipline that catches
  it next time.
- **DECISIONS.md ADR "New-node registration template required
  (CLAUDE.md §10)"** binds future mesh-node PRs to include a checklist
  in the §7 PR body naming each of the five required files
  (`manifest.yaml`, `secrets.ts`, `coreManager.ts`, the appropriate
  spawner, `.env.local.example`) plus the `schemas/` directory for
  TypeScript nodes, and binds Architect pre-merge review to confirm
  every file appears in the diff before approval. Refactor of the
  registration pattern into a single `registerNode()` factory is
  explicitly deferred post-Sprint-2 per §15's third-instance rule;
  an automated cross-check linter is reserved for future tooling.
- **`nodes/vision/`** — new Python mesh node, Piece 1 of the vision arc
  (per `docs/vision-roadmap.md` and PR #23 ADR). Captures camera frames
  at 10fps via macOS AVFoundation (pyobjc); exposes single surface
  `vision.frame()` returning JPEG q80 base64 at native dimensions. 5-second
  idle-timeout camera release. Two response shapes: `{ available: true,
  frame_b64, format, quality, width, height, timestamp }` on success;
  `{ available: false, reason }` on `warming_up | permission_denied |
  no_config`. Shell-side `visionDaemonManager.ts` lifts the daemon-
  supervision pattern from `ravenDaemonManager.ts`. `MESH_VISION_SECRET`
  wired into `secrets.ts` + `coreManager.ts`. Foundation for vision arc
  pieces 2/3/4 (gesture watcher, raven gesture actions, pointing app).
- **`nodes/weather/`** — new TypeScript mesh node polling Open-Meteo
  every 15 minutes. Two surfaces: `weather.current` (current conditions:
  temperature, humidity, wind, conditions string) and `weather.forecast`
  (1–7 day forecast, default 3, with daily highs/lows/conditions/precip).
  No-auth API. Graceful degradation when `AETHER_WEATHER_LAT/LON/LABEL`
  env vars missing. Polls in-memory; no persistent history. Voice tools
  `weather_current()` and `weather_forecast(days=3)` registered in
  raven-core (tool count 13 → 15). Weather section added to morning
  digest. `MESH_WEATHER_SECRET` wired into `secrets.ts` + `coreManager.ts`.
- **`docs/voice-extensibility-roadmap.md`** captures the five-piece
  design for organising Aether's voice tool substrate as the tool
  count grows past 13. Encodes the five tensions the arc resolves
  (no discoverability, no user-level composition, hand-written
  wrapper duplication, no modal context, no primitives for richer
  composition), the five pieces (tool registry + taxonomy with
  categories `time` / `memory` / `data` / `system` / `composer` /
  `creative` / `automation`; user automations / named sequences
  persisted in a SQLite `automations` table; mesh-surface
  auto-mapping via a `voice_tool` schema metadata block;
  adaptive modes — `default` / `morning` / `focus` / `evening` —
  with mode transitions riding session restarts to work around the
  `system_instruction` set-once constraint; composition primitives
  with sequential + parallel as v1 expressiveness and conditional
  steps deferred to v2), the PR sequence (`feat/voice-tool-registry`
  → `feat/voice-automations` + `feat/voice-mesh-automap` in parallel
  → `feat/voice-modes` → `feat/voice-composition`), composition with
  the voice-ambient and MCP arcs, and the explicit out-of-scope list
  (voice-created tools, tool versioning, cross-user / cloud sync,
  MCP auto-tooling, per-tool permission gates, conditional
  composition primitives, user-tunable thresholds). No
  implementation in this PR — design captured before any
  voice-extensibility code fires, same shape as
  `docs/voice-ambient-roadmap.md` and `docs/mcp-integration-arc-roadmap.md`.
- **DECISIONS.md ADR "Voice extensibility arc roadmap: five-piece
  tool substrate"** accepting the roadmap above, including rejected
  alternatives (single-PR bundle, ship Piece 5 before Piece 2,
  conditional primitives in v1 — bound deferral, YAML over JSON for
  sequence persistence, flat tool list without categories, defer the
  arc until ~25-30 tools).
- **`docs/mcp-integration-arc-roadmap.md`** captures the five-piece
  design for authenticated personal data sources (Google Calendar,
  Gmail, Drive) via the Model Context Protocol. Encodes the
  mesh-vs-MCP architectural split (mesh nodes for data Aether owns
  the pipeline for; MCP for third-party authenticated surfaces where
  the provider owns the contract and the auth), the sequenced PR
  shape (`feat/raven-mcp-client` → `feat/mcp-calendar` →
  `feat/mcp-gmail` + `feat/mcp-drive` in parallel →
  `feat/digest-mcp-sections`), the OAuth flow design (Electron shell
  launches system-browser auth, captures redirect on localhost,
  writes tokens to macOS Keychain under `com.aether.app`; raven-core
  reads from Keychain when invoking MCP servers), the privacy
  posture (no local persistence of authenticated data beyond the
  refresh token; on-demand fetch; Gemini Live is the only outbound
  channel in v1), and the explicit out-of-scope list (Microsoft 365,
  Apple ecosystem, chat platforms, multi-account, MCP server
  hosting). No implementation in this PR — design captured before
  any MCP code fires, same shape as `docs/vision-roadmap.md`.
- **DECISIONS.md ADR "MCP integration arc roadmap: authenticated
  personal data via MCP"** accepting the roadmap above, including
  rejected alternatives (custom per-provider mesh nodes,
  cloud-mediated MCP, local-LLM mediation in v1, Microsoft-first
  ecosystem).
- **Voice ambient arc roadmap** (`docs/voice-ambient-roadmap.md`) —
  five-piece design for voice as ambient presence: boot greeting,
  always-on VAD, wake word, idle behavior, real AEC. Captures library
  choices (silero-vad, openWakeWord, voiceProcessingIO), dependency
  ordering, privacy posture, and composition with the vision arc.
  No implementation in this PR; design captured before any voice-
  ambient code fires.

### Changed
- **Governance batch: CLAUDE.md amendments + auto-review workflow +
  README refresh.** Single PR bundling six CLAUDE.md codifications,
  two DECISIONS.md ADRs, a new GitHub Actions workflow that fires
  Claude on every PR for mechanical-check review, and a README sync to
  current state. CLAUDE.md changes: §8 binds the six-field ADR
  template (`Status`, `Decided by`, `Context`, `Decision`,
  `Consequences`, `Alternatives considered`) as required and codifies
  ADR ordering (newest at top within date, dates descending); §10
  gains three new gotchas on identity-rename stealth-residual surfaces
  (workflow YAML + `pnpm --filter` silent no-op, stale `dist/`
  masking workspace resolution failures, the long tail of non-code
  surfaces touched by a rename); §11 gains heuristic 9 on cross-doc
  consistency (literal grep across CLAUDE.md / MASTER_SYNTHESIS.md /
  DECISIONS.md / CHANGELOG.md / README.md / docs/* when a phrase /
  version / package name changes); a new §12 "Architectural Patterns"
  section is inserted (existing §12-§15 renumber to §13-§16) whose
  first entry §12.1 names the three-tier auth pattern (shell-UX /
  core-protocol / secret-store) bound by the MCP integration arc
  roadmap ADR. DECISIONS.md gains two ADRs (`Codify ADR template
  fields as required` and `Three-tier auth as a named architectural
  pattern`). `.github/workflows/claude-auto-review.yml` is new: fires
  on `pull_request: [opened, synchronize, reopened]`, runs five
  mechanical checks against §7 self-review completeness, CHANGELOG
  update, DECISIONS.md ADR format conformance, cross-doc consistency,
  and stealth-residual class issues; outputs a single comment with
  ✓ / ⚠ / ⊘ per check. Existing on-demand `.github/workflows/claude.yml`
  is unchanged. README refresh: badges and quickstart updated to the
  `Aether` repo identity, Node version raised to 22+ (yahoo-finance2
  v3 requirement), `Current state` header bumped to v0.5.0 with new
  v0.4.0 (composers / multi-hop mesh) and v0.5.0 (identity inflection)
  bullets and status-table rows. No source-code changes in this PR —
  docs and workflow only.
- CLAUDE.md §10 gains a Gemini Live system_instruction gotcha entry
  capturing PR #25's finding that the API field is set-once per
  session and cannot be hot-swapped per turn. Documents the
  FunctionResponse-body workaround pattern for per-turn context
  injection.
- **Project renamed: homeOS → Aether.** Working name retired. Updated:
  display name, app productName + bundle title, env vars
  (`HOMEOS_DATA_DIR` → `AETHER_DATA_DIR`), workspace package scope
  (`@homeos/*` → `@aether/*`), root npm package names
  (`homeos-shell` → `aether-shell`, `@homeos/raven-daemon` →
  `@aether/raven-daemon`), Electron bundle identifier
  (`com.homeos.app` → `com.aether.app`), preload bridge global
  (`window.homeOS` → `window.aether`), in-prose references throughout
  README / CLAUDE.md / MASTER_SYNTHESIS.md / manifest / node READMEs /
  voice system prompt. Historical DECISIONS.md ADRs and earlier
  CHANGELOG entries left verbatim — they describe what was decided /
  shipped under the working name. GitHub repository (`ashwinsreedhar28/homeOS`)
  and Director's local workspace directory remain on the working name
  until separately renamed; GitHub's auto-redirect keeps clone URLs
  alive. See DECISIONS.md "Rename project homeOS → Aether (working
  name retired)" for full rationale.
- **App icon: aurora curtain.** New cosmic-navy app icon (Concept C —
  dense diagonal aurora curtain, 11 sinuous lines with a bold center
  ribbon at line #6). Replaces the placeholder tray-only icon.
  Committed as SVG + generated PNG set + .icns bundle under
  `shell/assets/`. Wired into electron-builder config (`mac.icon`),
  Electron `BrowserWindow.icon`, and `app.setName('Aether')`.
- **One-time data directory migration.** On macOS first boot of the
  renamed app, the Electron main process renames the old userData root
  (`~/Library/Application Support/homeOS/`) to the new one
  (`~/Library/Application Support/Aether/`) before any node spawns —
  preserves news / finance / memory state. Idempotent; no-op on fresh
  installs.

- **First composer node on the homeOS mesh: `digest`.** New Node.js
  mesh node at `nodes/digest/` that synthesizes briefings by composing
  upstream data nodes — proves the mesh-as-a-graph property of
  RAVEN_MESH (every previous node was a leaf). Two surfaces:
  `digest.morning()` returns top breaking news + a markets snapshot;
  `digest.evening()` returns top recent headlines + market close +
  the day's SPY range. Each briefing is a `BriefingSection[]` whose
  `summary` field is voice-readable prose (2–3 sentences), with
  optional structured `items` for a future UI renderer. The composer
  fans out to upstream surfaces in **parallel via
  `Promise.allSettled`** with a 4s per-upstream timeout — a single
  upstream failure ships an `available: false` section ("News is
  unavailable right now…") rather than failing the whole briefing.
  Smoke-tested end-to-end (post-breaking-swap): morning briefing
  returns in ~30ms; empty `news_feeds.breaking` results render as
  "All quiet on the feeds this morning, sir — nothing breaking."
  with `available: true` (succeeded-but-empty, distinct from
  upstream-broken). Five outbound edges:
  `digest → news_feeds.breaking` (morning news source),
  `digest → news_feeds.recent` (evening news source),
  `digest → finance.market_summary`, `digest → finance.history`,
  `digest → host_notifications.notify` (scheduled delivery). Four
  inbound edges: `shell → digest.morning`, `shell → digest.evening`,
  `raven → digest.morning`, `raven → digest.evening`. No renderer-
  side Digest app in this PR — voice-only access in v1; shell edges
  are reserved for a follow-up UI. See DECISIONS.md "Digest engine:
  first multi-hop mesh composition".

  **Morning sources `news_feeds.breaking`; evening sources
  `news_feeds.recent`.** Morning briefings should surface what
  *actually matters* overnight — the urgency heuristic from PR #24
  gives us that signal, so the morning composer reads from
  `news_feeds.breaking` directly. Evening is the day's wrap-up — top
  of feed by recency is the right shape, so the evening composer
  keeps `news_feeds.recent`. The voice tool exposes no knowledge of
  urgency vs. recency; Gemini sees a single `digest_briefing` tool
  that returns coherent prose.
- **New voice tool `digest_briefing(time_of_day?)`.** Thin
  `mesh_invoke` wrapper around `digest.{morning|evening}` that joins
  each section's `summary` into a single `spoken` paragraph for
  Gemini to read verbatim. `time_of_day` defaults from the local
  clock (morning before noon, evening otherwise); explicit override
  via `time_of_day: 'morning' | 'evening'`. Three new few-shot
  examples in the system prompt covering the canonical phrasings
  ("give me the morning briefing" → `digest_briefing(time_of_day:
  'morning')`, "what's my evening rundown" → `digest_briefing(time_of_day:
  'evening')`, "brief me" → `digest_briefing()` letting the composer
  pick by local clock), plus an explicit "prefer `digest_briefing`
  over chaining `news_breaking` / `news_recent` +
  `finance_market_summary`" rule. The composer's internal fan-out
  across news / finance / history is invisible to Gemini — the tool
  description signals "returns a multi-section briefing", not how
  it's assembled. Same anti-hallucination guardrail as the rest of
  the voice stack — when the composer ships "Briefing unavailable",
  the model says so plainly rather than filling the gap from memory.
- **Opt-in scheduled briefings.** Digest node ships a basic in-
  process scheduler (`nodes/digest/src/scheduler.ts`) that fires
  morning + evening briefings on local-time hour boundaries (default
  07:00 / 18:00, configurable via `DIGEST_MORNING_HOUR` /
  `DIGEST_EVENING_HOUR`). Each scheduled fire composes the briefing
  and dispatches the lead section summary via
  `host_notifications.notify` ("Morning Briefing" / "Evening
  Briefing"). **Default off** — opt in with `DIGEST_SCHEDULED=true`.
  Fired-stamp suppression is process-memory only; a restart during
  the firing window may re-fire (acceptable for v1; persisted state
  under `HOMEOS_DATA_DIR/digest/` is the follow-up).
- **Shell wiring for the digest node.** `MESH_DIGEST_SECRET` joins
  the per-launch secrets bag; `coreManager` injects it at Core spawn
  time so the manifest's `env:MESH_DIGEST_SECRET` reference resolves;
  `nodeManager.spawnDigest()` joins the parallel `startAll()` fan-out
  alongside the three existing nodes; `staleSpawns` learns the digest
  PID-file + cmdline pattern; the shell's `predev` / `prebuild`
  scripts add `pnpm --filter @homeos/digest build` to the chain.
- **New JSON Schemas:** `nodes/digest/schemas/morning.json` +
  `evening.json`. Both are parameter-less (`additionalProperties:
  true`) — the briefing scope is fixed by surface choice, not by
  request payload.

- **Entity extraction on news articles.** Each article now runs through
  a lightweight NER pass (compromise's `.people()` / `.places()` /
  `.organizations()` matchers) in the poller after the article upsert.
  Extracted entities land in a new JOIN table
  `article_entities (article_id, entity_name, entity_kind, mentions)`
  with PRIMARY KEY `(article_id, entity_name)`. New mesh surface
  `news_feeds.search_by_entity({entity, kind?, limit?})` returns
  articles ranked by `mentions DESC, published_at DESC` for an exact
  case-insensitive entity-name match (`LOWER()` on both sides), with
  an optional `kind` filter (`person` / `place` / `organization`). DB
  schema bumps to `user_version=4`; the v3→v4 migration creates the
  JOIN table + index inside a single transaction (CLAUDE.md §10
  schema-migrations gotcha applied — column-dependent objects live in
  `migrate()`, not the initial CREATE block). Orthogonal to the v3
  urgency column: `article_entities` joins on `articles.id`, not on
  any urgency-related path. MeshDeny on empty / oversize entity
  strings (`news_feeds_bad_entity`) and on unknown kinds
  (`news_feeds_bad_entity_kind`). Spec named wink-nlp; verified during
  implementation that wink-nlp's built-in NER only handles DATE /
  TIME / MONEY / etc., not PERSON / PLACE / ORG — switched to
  compromise. See DECISIONS.md "News entity extraction via
  compromise". Existing articles backfill incrementally on each
  feed's next poll cycle (the extractor is pure and
  `replaceArticleEntities` is atomic delete-then-insert, so re-polls
  are idempotent).
- **New voice tool `news_search_by_entity(entity, kind?)`.** Thin
  `mesh_invoke` wrapper around `news_feeds.search_by_entity`. Same
  Article stripping as `news_recent` / `news_search` / `news_breaking`
  (urgency carries through to the response payload, same shape across
  all four read paths). Surfaces `news_feeds_bad_entity` and
  `news_feeds_bad_entity_kind` MeshDeny reasons as a structured
  `bad entity` error so Gemini speaks a clean "didn't catch the
  entity, sir" line. Prompt updates: tool count bumped to 13 (the
  in-prompt numbered tool list now also includes `news_breaking`,
  which PR #24 had added to function_descriptions and dispatch but
  not to the inline enumeration); new `news_search_by_entity` listed
  at position 10 between `news_breaking` and the finance triplet;
  explicit rule that PROPER NOUNS go to `news_search_by_entity` and
  COMMON-NOUN TOPICAL PHRASES go to `news_search`; four new few-shot
  examples ("what's the latest on Tim Cook" → person, "any news
  about Apple" → organization, "what's happening in Ukraine" →
  place, "any news about AI safety" → keyword); existing "what's
  the latest on Iran" / "tech news about OpenAI" / "anything on the
  Lakers" examples re-routed to the entity tool now that proper-noun
  precision is available; anti-hallucination guardrail extended to
  empty entity-search results ("no coverage on that in the feed
  pool yet, sir"). PR #25's Conversation Context block and
  follow-up reference examples preserved intact. See DECISIONS.md
  2026-05-13 "News entity extraction via compromise".
- **Two new manifest edges:** `shell → news_feeds.search_by_entity`
  (reserved for a future "tap an entity chip" UI affordance inside
  the News app — not consumed in this PR) and
  `raven → news_feeds.search_by_entity` (consumed immediately by
  the `news_search_by_entity` voice tool). Same multi-consumer-on-
  one-surface pattern established by `news_feeds.recent` /
  `news_feeds.search` / `news_feeds.breaking`.
- `nodes/news_feeds/schemas/search_by_entity.json` — JSON Schema
  validated by Core on every invocation. `entity` is required
  (1–100 chars); `kind` enum-validates against `person` / `place` /
  `organization`; `limit` defaults to 20, max 50.

- **News urgency scoring (heuristic).** Every article now gets a
  deterministic `urgency` bucket — `low` / `medium` / `high` — scored
  at fetch time by a pure-function heuristic in
  `nodes/news_feeds/src/scorer.ts`. No LLM, no external API calls. The
  0–100 score sums four independently-capped components: source weight
  (0–30, declared per-feed in `feeds.ts` across three tiers: 30
  Reuters-style breaking-news wires, 20 major outlets, 10 aggregators
  /blogs), title language (0–30: BREAKING/URGENT prefix +20, ALL-CAPS
  +15 with a combined cap, urgency vocabulary +5/word capped at +15),
  recency (0–25: <1h → 25, 1–4h → 15, 4–12h → 5, older → 0), and
  topic-keyword hits in title + summary (0–15: war / attack /
  shooting / earthquake / hurricane / wildfire / evacuation / recall
  / outbreak / tsunami). Buckets: low (0–39), medium (40–69), high
  (70+). All weight and threshold constants are exported from
  `scorer.ts` for transparency. Decouples "recency" from "importance"
  so voice queries like "what's breaking" return genuinely-newsworthy
  content rather than whatever happens to be freshest. See
  DECISIONS.md 2026-05-13 "News urgency scoring via heuristic" for
  the weight rationale and the alternatives we rejected (LLM scoring,
  user-tunable weights).
- **`news_feeds.recent` and `news_feeds.search` gain an optional
  `urgency` parameter** — either a single bucket or a 1–3-element
  unique array. JSON Schema enum-validates against `low|medium|high`.
  AND-combines with the existing category filter and (for search)
  the FTS5 match clause — `category='tech' + urgency='high'` returns
  high-urgency tech articles only.
- **New mesh surface `news_feeds.breaking({limit?})`.** Returns
  urgency='high' articles ordered by `published_at` desc. Default
  `limit` 10, clamped to 50. Strictly equivalent to
  `news_feeds.recent({urgency:'high'})` but named explicitly so the
  voice tool and any future "what's breaking" UI can address it
  directly. Backed by the new compound index
  `idx_articles_urgency_published_at`.
- **New voice tool `news_breaking(limit?)`.** Thin `mesh_invoke`
  wrapper around `news_feeds.breaking`. Same Article stripping as
  `news_recent` / `news_search` (now also carries `urgency` through
  to the response payload). System prompt enumerates the three
  urgency buckets, teaches Gemini to map "what's breaking" /
  "anything urgent" / "any major news" → `news_breaking()`,
  "what's important in tech" → `news_recent(category='tech',
  urgency='high')`, and "any urgent news on Iran" → `news_search`
  with `urgency='high'`. Anti-hallucination guardrail extended:
  empty `news_breaking` → "Nothing breaking in the feed pool right
  now, sir" — never substitute remembered headlines. `news_recent`
  and `news_search` voice tools also accept the optional `urgency`
  filter for category- / topic-bounded urgency queries.
- **Two new manifest edges** mirroring the existing `recent` /
  `search` pattern: `shell → news_feeds.breaking` (reserved for a
  future renderer-side breaking view — the v0.3.6 News app
  consumes via `recent` with `urgency='high'`) and
  `raven → news_feeds.breaking` (consumed immediately by the
  `news_breaking` voice tool). Same multi-consumer-on-one-surface
  pattern.
- **News app gains an "Urgent" chip and per-article urgency
  badges.** Chip row order: All → Urgent → seven category chips
  (broad → specific). The Urgent chip uses the breaking-red
  palette (matching the high-urgency badge); selecting it
  re-invokes `news_feeds.recent` with `urgency='high'` and no
  category filter — mutually exclusive with category selection.
  Article cards render a red "Breaking" badge for high-urgency
  items and an amber "Major" badge for medium; low is
  intentionally suppressed (visual quiet for routine items).
  Empty-state copy now branches three ways: first-poll vs. urgent
  ("Nothing breaking in the feed pool right now") vs. category
  filter.
- `nodes/news_feeds/schemas/breaking.json` — JSON Schema for the
  new surface. Single optional `limit` integer (1–50, default 10).

- **News keyword search backed by SQLite FTS5.** New mesh surface
  `news_feeds.search({query, limit?, category?})` ranks articles by
  bm25 across `title` / `summary` / `feed`, with `published_at` as
  tiebreaker. Backed by a contentless external-content FTS5 virtual
  table (`articles_fts`) with three sync triggers keeping it lockstep
  with `articles`; porter tokenizer for plural / verb-form stemming
  ("wildfire" matches "wildfires"). Search scope is the polled feed
  pool ONLY — not an open-web search; off-feed topics return empty
  rather than reaching out. DB schema bumps to `user_version=2`; the
  v1→v2 migration creates the virtual table, triggers, and backfills
  from existing articles inside a single transaction (CLAUDE.md §10
  schema-migrations gotcha applied — column-dependent objects live in
  `migrate()`, not the initial CREATE block). User-supplied query
  strings are sanitised into literal phrase tokens before reaching
  FTS5 MATCH so stray punctuation / accidental FTS5 grammar (`*`,
  `NEAR`, unbalanced quotes) can't break the query.
- **New voice tool `news_search(query, category?)`.** Thin
  `mesh_invoke` wrapper around `news_feeds.search`. Same Article
  stripping as `news_recent` (drops url / id / fetched_at /
  published_at — Gemini doesn't need them to speak headlines aloud).
  Surfaces `news_feeds_bad_query` MeshDeny as a structured `bad query`
  error so Gemini says "didn't catch the topic, sir" rather than
  reading the error stack. Prompt updates: four few-shot examples
  ("what's the latest on Iran" → `news_search({ query: 'Iran' })`,
  "any news on wildfires", "tech news about OpenAI" with category,
  "anything on the Lakers this week" with category), explicit "prefer
  `news_search` over `news_recent` for topic-specific questions"
  rule, and the anti-hallucination guardrail extended to empty search
  results ("no coverage in the feed pool yet, sir" — never substitute
  remembered headlines). See DECISIONS.md 2026-05-13.
- **Two new manifest edges:** `shell → news_feeds.search` (reserved
  for a future UI search bar inside the News app — not consumed in
  this PR) and `raven → news_feeds.search` (consumed by the
  `news_search` voice tool). Same multi-consumer-on-one-surface
  pattern established by `news_feeds.recent`.
- `nodes/news_feeds/schemas/search.json` — JSON Schema validated by
  Core on every invocation. `query` is required (1–200 chars);
  `limit` defaults to 20, max 50; `category` accepts a single string
  or 1–7-element array against the same seven-category enum as
  `recent`.

- **Finance historical quotes via passive accumulation.** The finance
  node now writes every successful poll to a SQLite time series at
  `$HOMEOS_DATA_DIR/finance/history.db` (90-day rolling retention,
  pruned at the start of each poll cycle). New surface
  `finance.history({symbol, period?})` reads the accumulated points
  back — periods `1d` / `1w` / `1m` / `all`, default `1w`; empty
  array on first-day installs is honest, not an error. The in-memory
  current-quote cache (`storage.ts`) is unchanged — the anti-decision
  against persisting *current* quotes still holds; this is a separate
  *historical* concern. New voice tool `finance_history(symbol,
  period?)` summarises the time series into a spoken-ready line
  ("AAPL this past week: ranged $230.10 to $238.42, currently up 1.4
  percent.") and special-cases insufficient-history with a "check
  back in a few hours" `spoken` field — the anti-hallucination
  guardrail extends to historical prices, which Gemini's training
  data contains in roughly-real-looking form. New JSON Schema at
  `nodes/finance/schemas/history.json`. Two new manifest edges
  (`shell → finance.history`, `raven → finance.history`).
- **In-card sparkline on the Finance app.** Each QuoteCard now
  renders an 80×24px SVG poly-line below the change row showing the
  last 24h of polled samples, stroke colour matching the day's
  direction (green up / red down). Skipped under 3 samples so a
  fresh install doesn't show a single dot. The renderer fetches
  history per symbol in parallel after `market_summary` lands — all
  reads hit the node's local SQLite, no upstream cost. See
  DECISIONS.md "Finance historical quotes via passive accumulation".

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

- **News feeds gain a seven-category taxonomy** (`world`, `us`, `tech`,
  `business`, `sports`, `science`, `local`). The catalog in
  `nodes/news_feeds/src/feeds.ts` expands from 4 → ~33 feeds across
  the seven categories; each feed declares exactly one category and
  every article inherits it at fetch time. New shared
  `nodes/news_feeds/src/types.ts` exports the `Category` union and the
  ordered `CATEGORIES` list — same ordering (broad → specific) is
  reused in the JSON Schema enum, the voice prompt, and the UI chip
  row. `_ingest/Pulse` is empty in this checkout, so feeds were
  reconstructed from well-known public RSS endpoints rather than
  lifted directly. See DECISIONS.md 2026-05-13.
- **`news_feeds.recent` accepts an optional `category` parameter** —
  either a single category string or a 1–7-element unique array.
  JSON Schema enum-validates against the seven known values, so an
  unknown category returns a Core-level `denied_schema_invalid` before
  the handler runs. Empty / missing category preserves v0.3.0
  behaviour (across all categories). Storage gains a compound
  `(category, published_at DESC)` index so filtered reads stay
  sub-ms even as the corpus grows.
- **Forward-only SQLite migration** in `nodes/news_feeds/src/storage.ts`:
  `DB_VERSION = 1`, `PRAGMA user_version` gates a transactional
  ALTER TABLE that adds `category TEXT NOT NULL DEFAULT 'world'`
  for v0.3.0 installs. Existing rows carry the 'world' default until
  the next poll's UPSERT re-categorises them (the UPSERT now updates
  the category column on conflict; dedup key `sha1(feed::guid)`
  unchanged). One-time inaccuracy of ≤15 min; fresh installs are
  correct from row 1.
- **Voice tool `news_recent` gains a `category` parameter.** Gemini
  function declaration carries the category enum; system prompt
  enumerates the seven categories with one-line semantics, adds
  natural-language mapping rules, and includes four new few-shot
  examples ("what's the latest tech news" → `category='tech'`,
  "any local headlines" → `category='local'`, "what's happening in
  the world" → `category='world'`, "give me top news" → no category).
  Anti-hallucination guardrail from PR #14 preserved.
- **News app gains a category filter row.** Chip row at the top of
  `shell/src/apps/news/News.tsx`: "All" plus the seven categories,
  ordered identically to `types.ts` and the voice prompt. Selecting
  a chip re-invokes `news_feeds.recent` with the new category and
  re-renders. Article cards show the feed name and a category badge
  below it. Empty-state copy is context-aware: "No recent articles
  in Tech." when a category filter is active vs. the generic
  "Headlines refreshing" when "All" is selected.

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

- **Finance node drops the API key — Yahoo Finance + Stooq.** The
  finance node now fetches via `yahoo-finance2` (primary) with a Stooq
  CSV fallback when Yahoo errors. No `FINNHUB_API_KEY` required;
  `.env.local.example` and the nodeManager spawn env updated
  accordingly. `pnpm dev` boots without any provider env var set.
  Quote shape gains `volume` (Yahoo + Stooq both return it on the
  single quote call); the renderer's QuoteCard shows a Volume row
  (formatted 12.3M / 1.2B / —). Voice tool's `_strip_quote` continues
  to drop volume from spoken readbacks. `QuoteClientError` gains
  `provider_error` for the both-providers-failed case;
  `finance_rate_limited` MeshDeny is no longer reachable (the voice
  tool's `_throttled_response` and the renderer's `ThrottledState`
  stay defined as dead branches for reuse). See DECISIONS.md "Second
  data node: finance" → Update.
- **`MeshUnavailable` (Python, `raven_core/mesh_client.py`) gains an
  optional `reason` attribute.** Set to the MeshDeny reason from the
  remote node when the failure path was a `kind=error` response;
  `None` for setup-time failures (env unset / SDK import failed /
  register failed). Lets voice tools branch on `e.reason ==
  "finance_rate_limited"` rather than parsing the exception string —
  the cleaner shape that every future mesh-routed tool will benefit
  from. Existing call sites that only `except MeshUnavailable` are
  unaffected.
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
- CLAUDE.md §10 gains a "Schema migrations" subsection capturing
  the migration-order gotcha from PR #16 (column-dependent indexes
  must be created inside the migration step, not the initial
  CREATE block).
- CLAUDE.md §10 gains a "Worktrees and the GitHub CLI" subsection
  capturing the `gh pr merge --delete-branch` collision pattern
  when running from feature worktrees (bit PRs #12 and #18).

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
