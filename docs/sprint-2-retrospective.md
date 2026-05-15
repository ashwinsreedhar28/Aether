# Sprint 2 Retrospective — Aether v0.6.0 → v0.7.0

**Date range:** 2026-05-14 → 2026-05-15 (two calendar days)
**Tag range:** `v0.6.0` (2026-05-14) → `v0.7.0` (2026-05-15, anticipated)
**PR range:** PR #46 through PR #56 (10 PRs)

Sprint 2 was the first multi-arc parallel sprint. It opened with an ambitious eight-lane first wave (system_info, reminders, finance-extended, calendar, vision gesture watcher, voice boot greeting, voice always-on VAD, MCP client substrate) that exposed the limits of simultaneous new-mesh-node work without the `registerNode()` abstraction. Mid-sprint pivoted to governance/docs consolidation and single-lane focused work. Closed with the reminders hot-fix that established the voice-tool declaration pattern as canonical.

## What we built

### PRs landed

- **PR #46** (`docs/sprint-1-retrospective`) — Sprint 1 retrospective document.
- **PR #47** (`docs/vision-gesture-roadmap`) — Vision gesture arc design doc (5 pieces).
- **PR #48** (`docs/mesh-node-wiring-pattern`) — Five-file mesh-node registration pattern doc.
- **PR #49** (`chore/registerNode-abstraction`) — `registerNode()` substrate eliminating the four-file-per-node wiring tax.
- **PR #50** (`docs/voice-tool-declaration-pattern`) — Voice tool canonical pattern (FunctionDeclaration + Tool + get_tools + handle_call_async).
- **PR #51** (`feat/calendar-node`) — macOS Calendar mesh node via EventKit, two surfaces (`calendar.events_today`, `calendar.upcoming_events`), two voice tools.
- **PR #52** (`fix/calendar-bugs`) — Four post-merge calendar fixes (surface name mismatch, grace logic, all-day events, no-calendar case).
- **PR #53** (`feat/finance-extended`) — Extended finance node with movers, sectors, earnings, market overview (4 new surfaces, 4 new voice tools).
- **PR #54** (`feat/system-info-node`) — macOS system info node (battery, memory, disk, network, display brightness).
- **PR #55** (`feat/reminders-node`) — macOS Reminders.app mesh node via EventKit.
- **PR #56** (`fix/voice-tool-declarations`) — Voice tool hot-fix rewriting reminders + system_info tools to match the Gemini FunctionDeclaration pattern.

### Substrate

- **`registerNode()` abstraction** (PR #49). Collapsed the four-file-per-node wiring tax (`paths.ts`, `nodeManager.ts`, `coreManager.ts`, `secrets.ts`) into a single call site. Retrospectively applied to all existing data nodes (weather, vision, calendar). Five-file mesh-node pattern (PR #48) is now visible as "what registerNode does for you."

- **Voice tool declaration pattern codified** (PR #50, enforced by PR #56). Canonical shape for all voice tools: `FunctionDeclaration` (Gemini's schema format) + `Tool` (genai SDK's wrapper) + `get_tools()` returning the list + `handle_call_async(name, args)` dispatching by name. Hot-fix in PR #56 rewrote `system_info` and `reminders` to match after their initial drafts during a Claude Code outage missed the pattern.

### Data / mesh nodes

- **`nodes/calendar/`** (PR #51, hot-fixed by PR #52). TypeScript mesh node via macOS EventKit. Two surfaces: `calendar.events_today` (24h window with 30min grace), `calendar.upcoming_events` (next 7 days). Two voice tools (`calendar_today`, `calendar_upcoming`). Four post-merge bugs caught by smoke test: surface name typo in voice tool calls, grace logic off-by-one, all-day event duration NaN, crash when user has no calendars.

- **`nodes/finance/` extended** (PR #53). Four new surfaces: `finance.movers` (top gainers/losers), `finance.sectors` (sector performance), `finance.earnings` (upcoming earnings), `finance.market_overview` (indices). Four new voice tools. Lifts from Pulse's finance service.

- **`nodes/system_info/`** (PR #54, hot-fixed by PR #56). TypeScript mesh node for macOS system state. Five surfaces: `system_info.battery`, `system_info.memory`, `system_info.disk`, `system_info.network`, `system_info.display_brightness`. Voice tools rewritten in PR #56 to match declaration pattern.

- **`nodes/reminders/`** (PR #55, hot-fixed by PR #56). TypeScript mesh node via macOS EventKit Reminders.app. Three surfaces: `reminders.list` (all incomplete), `reminders.create`, `reminders.complete`. Voice tools rewritten in PR #56.

### Design docs

- **`docs/vision-gesture-roadmap.md`** (PR #47). Five-piece vision gesture arc: capture foundation (done in Sprint 1 PR #43) → gesture watcher → action dispatch → config surface → adaptive learning. Sequential dependencies bound.

- **`docs/mesh-node-wiring-pattern.md`** (PR #48). Documents the five-file mesh-node registration pattern that PR #49's `registerNode()` subsequently automated. Preserved as the conceptual reference ("what happens under the hood").

- **`docs/voice-tool-declaration-pattern.md`** (PR #50). Canonical voice tool shape with the four-component structure (FunctionDeclaration / Tool / get_tools / handle_call_async). Codifies the pattern that PR #56 enforced retroactively.

### Governance / process

- **Sprint 1 retrospective** (PR #46) — first sprint retro document, modeling the format this doc follows.

## What worked

- **Parallel docs/governance lanes don't block implementation.** PRs #46, #47, #48, #50 ran in parallel to implementation lanes without merge conflicts or context-switching cost. Docs naturally bundle (Sprint 1 retro + vision-gesture roadmap + two pattern docs) and merge fast.

- **Pattern docs cut investigation time.** The voice-tool-declaration-pattern doc (PR #50) landed before the reminders/system_info lanes fired. When PR #56 rewrote those tools, the pattern doc was the single source of truth — no re-deriving from `raven_core/tools/` inspection.

- **Manual chat-completion as fallback for dead Implementer sessions.** When Claude Code outage killed the system_info and reminders lanes mid-flight, Director manually completed the drafts in chat with Architect, then pasted the final code back to a fresh Implementer session for commit. The work didn't block on harness availability.

- **Finance-extended single-lane focused work.** PR #53 (finance extended) was the only substantive implementation lane that shipped clean on first merge — no hot-fix follow-up. Single-lane focus + lifting from Pulse's proven finance service + no new mesh-node wiring (finance already existed) = no surprise gaps.

- **`registerNode()` retroactively applied.** PR #49 introduced the abstraction and immediately applied it to weather, vision, and calendar in the same PR. Proving the abstraction works for existing nodes before new nodes depend on it avoided a "new abstraction, untested foundation" failure mode.

## What hurt

- **8-lane Sprint 2 first-wave fire was too many.** The initial sprint plan opened eight parallel lanes (system_info, reminders, finance-extended, calendar, vision gesture watcher, voice boot greeting, voice always-on VAD, MCP client substrate). Four Implementer sessions died mid-flight. The four new-mesh-node lanes (system_info, reminders, calendar, finance-extended) all hit the same wiring surface (`nodeManager.ts`, `coreManager.ts`, `secrets.ts`, `paths.ts`) before PR #49's `registerNode()` existed. Merge conflicts and implicit contract drift killed velocity. Conclusion: never fire 2+ new-mesh-node lanes in parallel without the `registerNode()` substrate.

- **Pattern doc accuracy gaps surfaced during calendar lane.** PR #48 (mesh-node-wiring-pattern) documented the five-file pattern but shipped with an under-specified example (incomplete env var wiring, missing schema-file requirement for TS nodes). Calendar (PR #51) was the first new node to build against the doc and hit four separate gaps that required mid-lane clarifications from Architect. Pattern docs must be canonical *before* firing new-node lanes, not "good enough to start."

- **Voice tool drafts during Claude Code outage missed Gemini-declaration pattern.** System_info and reminders voice tools were drafted during a Claude Code outage via manual chat completion. The drafts used plain async functions (the old pattern) instead of the FunctionDeclaration + Tool structure (PR #50's canonical pattern). PR #56 was a same-day hot-fix rewriting both. Cost: two PRs' worth of rework that would have been avoided if the pattern doc had been in-context during the drafts. Lesson: when working around an outage via manual completion, load the pattern doc into the chat session explicitly.

- **Python 3.14 + pyobjc<11 source build failure.** The reminders node (PR #55) required `pyobjc-framework-EventKit`, which on Python 3.14 attempts a source build (pyobjc 10.x predates Python 3.14 support). The build failed with a gcc error. Workaround: pin Python 3.13 in the reminders venv until pyobjc 11+ lands on PyPI. This is the second Python-3.14 pyobjc gotcha (first was vision in Sprint 1). Discipline: new Python nodes default to Python 3.13 until pyobjc ecosystem catches up.

- **Node 20 + yahoo-finance2 silent slowness.** Finance-extended (PR #53) experienced 8-12 second response times for market movers/sectors queries during development. Cause: yahoo-finance2's internal rate-limiting + Node 20's DNS resolver interacting poorly. Switching to Node 22 (from the user's path, not the Electron-bundled runtime) dropped latency to 2-3 seconds. Not a blocking issue but a QoL regression that wasn't obvious from build/typecheck/lint.

## What we learned (codified)

### CLAUDE.md §10 — gotchas added or reinforced this sprint

- **Mesh-node registration is a five-file pattern** (codified in DECISIONS.md 2026-05-14 ADR). Adding a new mesh node requires touching, at minimum: `manifest.yaml`, `secrets.ts`, `coreManager.ts`, the runtime-appropriate spawner (`nodeManager.ts` or a daemon manager), and `.env.local.example`. TypeScript nodes additionally require `schemas/` JSON files matching every declared surface — Core hard-fails with `FileNotFoundError` if a manifest entry references a missing schema. Missing any one produces confusing runtime symptoms rather than clean build-time failure. PR #49's `registerNode()` automates four of the five (all except `manifest.yaml`).

- **Architect-authored spec drift from the canonical ADR** (new §10 entry, anticipated in Sprint 3 governance PR). Implementer specs can diverge from the binding ADR on subtle but load-bearing points (platform identifier, surface name, lifecycle hooks, response shape). Vision-capture spec (Sprint 1 PR #43) went through three revisions before implementation matched the ADR's surface contract. Discipline: before writing code, diff the lane spec against the ADR it cites — literal grep of surface names, platform identifiers, lifecycle terms — and surface any disagreement in the PR body or chat *before* implementation.

### Multi-lane format evaluation

Sprint 2 tested the multi-lane parallel model under stress and produced binding data:

- **8 lanes = broken.** Too many. Four Implementer sessions died. Merge conflicts on shared wiring surfaces (pre-`registerNode()`) killed velocity. Context-switching cost (reviewing eight in-flight PRs) exceeded the parallelism win.

- **3 lanes = works.** Docs/governance + one or two implementation lanes is the sustainable steady state. Docs don't block implementation; implementation doesn't thrash wiring surfaces.

- **2 lanes = sweet spot for substantive work.** When both lanes are implementation (not docs), two is the ceiling before wiring-surface conflicts appear. Calendar + finance-extended could have run in parallel cleanly (one new node, one existing-node extension); calendar + reminders + system_info could not (three new nodes, same surfaces).

- **1 lane = focused for tricky work.** Finance-extended (PR #53) was single-lane and shipped clean because it had full Implementer attention and no merge-conflict risk. For any lane that lifts complex logic, introduces a new runtime, or touches a shared surface under active churn, single-lane focus is the safe default.

- **Mix matters.** 1 substrate PR + 1-2 feature PRs + docs is the healthy composition. Substrate PRs (`registerNode()`, voice-tool-registry, MCP client) are force multipliers — they make future feature PRs cheaper — but they're also high-risk (they touch everything). Never run two substrate PRs in parallel.

### Process discipline

- **Pattern docs must be canonical before new-lane fire.** Docs that say "here's the shape" but ship with under-specified examples or missing gotchas become a trap — the first implementer to build against the doc hits every gap as a mid-lane clarification round-trip. Better: one reference-implementation PR that proves the pattern, then the pattern doc that distills it, then new lanes that follow the doc. Sprint 2 inverted this (doc before proving) and paid the clarification tax.

- **Voice tool files require four-component structure.** Every voice tool is FunctionDeclaration (Gemini's schema) + Tool (genai SDK wrapper) + `get_tools()` (returns list) + `handle_call_async(name, args)` (dispatch by name). Plain async functions (the old pattern from early voice work) are insufficient — Gemini Live requires the explicit FunctionDeclaration shape. PR #56 enforced this retroactively; future voice tools follow PR #50's pattern from the start.

- **TS-node-build-after-pull gotcha needs solving.** When package A imports `@aether/mesh-node-sdk`, A's typecheck resolves via the SDK's compiled `dist/`, not `src/`. On a clean tree (or after `git pull` that updates the SDK), typecheck fails until the SDK is built first. Current discipline is "order as `pnpm -r build` → `pnpm -r typecheck`" but this is a footgun for contributors. Queued for Sprint 3 consideration: either (a) pre-build script in the root `package.json`, (b) TypeScript project references, or (c) accept the discipline and document it loudly in CONTRIBUTING.md.

## Sprint 3 prep notes

Sprint 3's bottleneck-unlock work:

- **`registerNode()` is the critical substrate for Sprint 4's parallel mesh-node lanes.** Now that PR #49 exists, multiple new-node lanes can run in parallel without wiring-surface thrash. Sprint 3 should exploit this — target is 2-3 new nodes in parallel (each in its own lane) to prove the abstraction holds under real parallelism.

- **Voice-tool-registry is the second critical substrate.** The tool count is currently 19 (after Sprint 2's additions). The in-prompt numbered enumeration is computed (fixed in Sprint 1's `fix/raven-tool-count-mismatch`) but the tools themselves are still hand-wired in `raven_core/tools/__init__.py`. Voice-extensibility roadmap's Piece 1 (tool registry) is the unlock for voice tools to scale past 20 without turning the tools file into a 1000-line monolith.

- **MCP client substrate queued but deferred.** Sprint 2's initial plan included the MCP client lane; it got deferred when the eight-lane fire collapsed. Sprint 3 candidate, but not load-bearing for Sprint 4 mesh-node parallelism the way `registerNode()` and voice-tool-registry are.

- **Vision gesture watcher queued but deferred.** Also part of the Sprint 2 initial plan; also deferred. Vision gesture roadmap's Piece 2. Sprint 3 candidate if Director's attention shifts to vision; otherwise queued for Sprint 4.

Likely Sprint 3 shape (Architect's call):
- 1 substrate lane (`feat/voice-tool-registry`)
- 2 implementation lanes (candidates: MCP client substrate, vision gesture watcher, one new mesh node proving `registerNode()` under real use)
- Docs/governance bundle (Sprint 2 retro + any new pattern docs + cross-doc cleanup)

## Open questions

- **TS-node dist/ build dependency.** Current discipline (`pnpm -r build` before `pnpm -r typecheck`) works but is a contributor footgun. Sprint 3 decision: accept and document loudly, or invest in a pre-build script / TypeScript project references to make `pnpm install` → `pnpm typecheck` work on a clean tree without the intermediate build step.

- **Python 3.14 + pyobjc ecosystem lag.** Two nodes now pinned to Python 3.13 (vision, reminders). When pyobjc 11+ lands on PyPI with Python 3.14 support, upgrade both. Until then, new Python nodes default to 3.13.

- **yahoo-finance2 latency on Node 20.** Finance-extended works but is slower than ideal on Node 20. Node 22 improves it. Not blocking, but if other nodes hit similar slowness, consider Node 22 as the default runtime for TS nodes (currently using Electron-bundled Node 20).

- **Parallel mesh-node lane ceiling.** Sprint 2 proved 3+ new nodes in parallel = broken (pre-`registerNode()`). Now that `registerNode()` exists, what's the new ceiling? Sprint 3 target: fire 2-3 new-node lanes in parallel to empirically establish the post-abstraction limit.

- **Voice tool count at 19, heading toward 25+.** Current system prompt handles 19 tools; Gemini Live has shown no degradation yet. At what count does tool-retrieval or a tiered taxonomy become load-bearing? Voice-extensibility roadmap defers this to Piece 2 (taxonomy) but doesn't specify a count threshold. Empirical rule: if tool-selection latency or accuracy degrades visibly, taxonomy moves up the priority list.
