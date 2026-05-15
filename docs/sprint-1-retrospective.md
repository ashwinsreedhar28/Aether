# Sprint 1 Retrospective — Aether v0.5.0 → v0.6.0

**Date range:** 2026-05-14 (single calendar day, ~16h elapsed wall-clock between tags)
**Tag range:** `v0.5.0` (2026-05-14 02:28 PDT) → `v0.6.0` (2026-05-14 16:38 PDT)
**PR range:** PR #28 through PR #45 (18 PRs)

Sprint 1 was the first sprint after the project-name inflection. It spanned
the rename PR that cut v0.5.0, three new arc-roadmap design docs,
governance-discipline codification, two implementation lanes (weather + vision
Piece 1), and a two-PR post-merge cleanup. Director's parallel work on the
home-box buildout ran off-repo and is not reflected directly in the PR ledger.

## What we built

### Substrate

- **Project rename `homeOS → Aether`** (PR #28, cut as `v0.5.0`). Working name
  retired. Bundle id `com.homeos.app → com.aether.app`, env var
  `HOMEOS_DATA_DIR → AETHER_DATA_DIR`, npm scope `@homeos/* → @aether/*`,
  preload bridge global `window.homeOS → window.aether`, Electron
  `productName`, voice system prompt display name. One-time idempotent
  userData migration (`~/Library/Application Support/homeOS/ → /Aether/`)
  preserves news / finance / memory state. New aurora-curtain app icon
  (Concept C, cosmic-navy, 11-line diagonal curtain). Historical
  DECISIONS.md and CHANGELOG entries left verbatim by append-only policy.

### Data / mesh nodes

- **`nodes/weather/`** (PR #42, hot-fixed by PR #44 + PR #45). TypeScript mesh
  node polling Open-Meteo every 15 minutes; no auth. Two surfaces:
  `weather.current` and `weather.forecast`. Graceful degradation when
  `AETHER_WEATHER_LAT/LON/LABEL` are unset. Two new voice tools
  (`weather_current`, `weather_forecast`) bumping the voice tool count
  13 → 15. Weather section added to morning digest. `MESH_WEATHER_SECRET`
  joins the per-launch secrets bag.

- **`nodes/vision/`** (PR #43, hot-fixed by PR #45). Python mesh node, Piece 1
  of the vision arc per `docs/vision-roadmap.md` (PR #23). Captures camera
  frames at 10fps via macOS AVFoundation (pyobjc); 5-second idle-timeout
  camera release; single `vision.frame()` surface returning JPEG q80 base64.
  Two response shapes: `{ available: true, frame_b64, ... }` on success,
  `{ available: false, reason }` on `warming_up | permission_denied |
  no_config`. Shell-side `visionDaemonManager.ts` lifts the
  daemon-supervision pattern from `ravenDaemonManager.ts`. Foundation for
  vision arc pieces 2/3/4.

### Design docs (3 new arc roadmaps landed)

- **`docs/voice-ambient-roadmap.md`** (PR #30). Voice as ambient presence in
  five pieces: boot greeting → always-on VAD (silero-vad) → wake word
  (openWakeWord) → idle behavior → real AEC (Apple `voiceProcessingIO`).
  Sequential within the arc, parallel to the vision arc.
- **`docs/mcp-integration-arc-roadmap.md`** (PR #31). Authenticated personal
  data via MCP in five pieces: client substrate → Calendar → (Gmail + Drive
  in parallel) → digest-MCP-sections. Codified the mesh-vs-MCP split (Aether
  owns the pipeline → mesh; provider owns the contract → MCP).
- **`docs/voice-extensibility-roadmap.md`** (PR #40). Five-piece tool
  substrate organising the voice tool count past 13: tool registry +
  taxonomy → (automations + mesh-auto-mapping in parallel) → adaptive modes
  → composition primitives. Sequential + parallel are bound for composition
  v1; conditionals are a v2 binding deferral.

The pre-existing `docs/vision-roadmap.md` (PR #23) carried forward as the
spec PR #43 built against — first time the roadmap-before-code pattern
proved load-bearing for an implementation PR.

### Governance / process

- **§10 gotcha codified** (PR #29): Gemini Live `system_instruction` is set
  once per session and cannot be hot-swapped per turn. Workaround pattern
  (FunctionResponse-body context) documented.
- **GitHub Claude app wiring** (PRs #32, #33, #34): API key secret, checkout
  step, pin to `claude-sonnet-4-5-20250929`.
- **Repo public-facing surfaces** (PRs #35, #36, #37, #38): Contributor
  Covenant CODE_OF_CONDUCT, CONTRIBUTING.md pointing to CLAUDE.md, issue
  templates.
- **Governance batch** (PR #39, `chore/governance-batch`): bundled six
  CLAUDE.md amendments, two DECISIONS.md ADRs, a new auto-review workflow,
  and a README refresh into one docs-only PR. Specifically:
  - §8 ADR template bound as required — six fields (`Status`, `Decided by`,
    `Context`, `Decision`, `Consequences`, `Alternatives considered`) in that
    order, ordering rule (newest at top within date, dates descending).
  - §10 gained the three identity-rename stealth-residual gotchas (workflow
    YAML + `pnpm --filter` silent no-op; stale `dist/` masking workspace
    resolution failures; long tail of non-code rename surfaces).
  - §11.9 cross-doc consistency heuristic — when a literal phrase or version
    number appears in multiple docs, treat the set as one surface.
  - New §12 "Architectural Patterns" section opened (renumbering §12–§15 to
    §13–§16). First entry §12.1: three-tier auth (shell-UX / core-protocol /
    secret-store), bound by the MCP roadmap ADR.
  - `.github/workflows/claude-auto-review.yml`: fires on every PR, runs five
    mechanical checks (§7 template completeness, CHANGELOG update,
    DECISIONS.md ADR format, cross-doc consistency, stealth-residual class),
    posts a single ✓/⚠/⊘ comment.
- **Auto-review workflow input fix** (PR #41): `prompt → direct_prompt`
  rename caught immediately after PR #39 merged.

### Post-merge cleanup

- **PR #44** (`fix/weather-schemas`): `nodes/weather/schemas/{current,
  forecast}.json` were registered in the manifest by PR #42 but never
  actually written. Core failed to load with `FileNotFoundError` on launch.
  Caught by smoke test after merge.
- **PR #45** (`fix/weather-vision-wiring`): five completion gaps from PRs
  #42/#43 that build/typecheck/lint did not catch:
  1. `nodeManager.ts` — no `spawnWeather()` method; weather node was never
     spawned despite being declared in the manifest.
  2. `nodeManager.ts` — weather needed `AETHER_DATA_DIR` in `extraEnv` per
     the data-node pattern.
  3. `paths.ts` — `WEATHER_ENTRY` constant was missing.
  4. `coreManager.ts` — `MESH_VISION_SECRET` was never passed to Core; Core
     auto-generated its own and the daemon got a 401 on register.
  5. `visionDaemonManager.ts` + `nodes/vision/main.py` — used `VISION_SECRET`
     (wrong env var name for the Aether convention; should be
     `MESH_VISION_SECRET`).
  6. `nodes/vision/main.py` — imported from `CoreVideo` directly; the pypi
     package `pyobjc-framework-CoreVideo` does not exist. CoreVideo is
     bundled inside `pyobjc-framework-Quartz` and must be reached via
     `Quartz.CoreVideo`.

## What worked

- **Roadmap-before-code held up.** Three arc roadmaps landed before any of
  their implementation PRs fired. Vision Piece 1 (PR #43) was the first PR
  that built directly against a pre-merged roadmap doc (`vision-roadmap.md`
  from PR #23) — the spec answered the scope questions before review had to.
- **Governance batching saved review rounds.** PR #39 bundled six CLAUDE.md
  amendments + two ADRs + a new workflow + the README refresh into a single
  docs-only PR. No source code touched → low review risk → one round-trip
  cleared the batch. The class of work (governance discipline) suits
  bundling specifically because individual amendments would each have
  reviewed in isolation and aggregated to the same review cost with more
  context-switching.
- **Six-field ADR template now mechanically checkable.** §8's binding plus
  the auto-review workflow's ADR-format check turns "did you remember
  Alternatives considered" from a reviewer judgement call into a build-side
  green/red.
- **§12 opened.** Naming the three-tier auth pattern before its second
  instance gives Sprint 2's MCP-Calendar PR a vocabulary to reference
  instead of re-deriving the boundary.
- **Single-day cadence held.** v0.5.0 and v0.6.0 cut on the same calendar
  day (16h wall-clock apart). 18 PRs merged in that window. Velocity
  remained positive despite the day's friction (see below).

## What hurt

- **Opus 4.7 release-day disruption ate ~4 hours.** Sprint 1 ran on the day
  Opus 4.7 went GA. Tooling churn, fast-mode toggling, regression behaviors
  in the harness, and one wrong-model invocation cost roughly four hours of
  productive Implementer time before the day's substantive work could
  resume. Not a quality issue — a calendar-luck issue — but worth recording
  because Sprint 1's apparent compression masks how compressed it actually
  was.
- **PR #42 and PR #43 both passed build/typecheck/lint and both shipped
  broken.** Five wiring gaps in PR #45 + the missing schemas in PR #44 = two
  hot-fix PRs that should not have been necessary. Static checks passed
  because (a) the missing `spawnWeather()` was an absence, not a type error;
  (b) the wrong env var name was a string mismatch across a runtime
  boundary; (c) the wrong pyobjc import path was a Python module-not-found
  caught only at process spawn; (d) the missing schema files were a file
  path resolved at Core startup. Conclusion: green CI is not evidence of a
  working merge for data nodes. A post-merge smoke-test stage that spawns
  the shell with the new node enabled would have caught at least four of
  the five gaps.
- **Parallel-lane merge friction.** Weather (PR #42) and vision (PR #43)
  both modified `coreManager.ts` and `nodeManager.ts`. They merged
  independently, both green, but PR #45 had to reconcile the implicit
  contract between them (the per-node env-var convention) after the fact.
  This is the cost of running two implementation lanes against the same
  shell-side wiring surface without an explicit `registerNode()`
  abstraction. Flagged as a Sprint 2 refactor candidate.
- **Voice tool-count drift.** Weather added two tools (13 → 15) in PR #42.
  The tool count appears in the in-prompt numbered enumeration as a literal
  string — easy to miss, easy to drift. Resolved post-sprint via
  `fix/raven-tool-count-mismatch` (open-question section below).
- **PR #38 / PR #36 / PR #37 / PR #35 redundancy.** Four near-back-to-back
  PRs for CONTRIBUTING / CODE_OF_CONDUCT / issue templates that could have
  been one bundle. Process-side: the governance-batching insight (later
  applied successfully in PR #39) was not yet in hand for the earlier
  public-facing-surface PRs. Acceptable cost — the bundling discipline
  emerged from the very PRs that lacked it.
- **PR #41 immediately after PR #39.** The auto-review workflow shipped
  with the wrong input name (`prompt` instead of `direct_prompt`) and had
  to be patched the same day. Single-character class of typo; would have
  been caught by ever running the workflow against a real PR before merging,
  which by definition isn't possible until after merge.

## What we learned (codified)

### CLAUDE.md §10 — gotchas added this sprint

- **Gemini Live `system_instruction` is set once per session.** (PR #29.)
  `LiveConnectConfig`'s `system_instruction` is fixed at session start and
  cannot be hot-swapped per turn. Sending a new `LiveConnectConfig`
  mid-session has no effect. Workaround for per-turn context: attach
  contextual data to `FunctionResponse` bodies via `_session_context`;
  Gemini reads it alongside the tool output. For state that must persist
  across turns without a tool-call mediating, the only options are (a)
  restart the session with a new `system_instruction`, or (b) feed context
  through the next tool result.
- **Identity-rename stealth-residual surfaces.** (PR #39, three sub-items.)
  - **Workflow YAML is a stealth-residual surface during identity renames.**
    `pnpm --filter <pkg>` does NOT fail when the filter matches zero
    packages — it logs `No projects matched the filters` and exits 0. A
    renamed workspace package with an un-updated workflow filter turns
    into a green no-op CI check that masks the rename gap.
  - **Stale local `dist/` can mask workspace resolution failures that CI
    catches.** After a rename, a previous build's `dist/` plus a populated
    `node_modules/.pnpm` store may resolve imports locally even though the
    new identity isn't actually wired through. Do
    `rm -rf node_modules dist && pnpm install && pnpm -r build` before
    opening the PR.
  - **Identity renames have a long tail of non-code surfaces.** README
    badges, workflow YAML filters, status-check names referenced by branch
    protection, `.env.example`, electron-builder `productName`/`appId`,
    preload bridge globals, userData migration, voice system prompt display
    name. Build a per-rename checklist; the rename PR's §7 self-review
    should walk it explicitly.

### Process discipline codified

- **§8 ADR template bound** as required: six fields (`Status`, `Decided by`,
  `Context`, `Decision`, `Consequences`, `Alternatives considered`) in that
  exact order; ordering rule (newest at top within date, dates descending).
  Mechanically checkable.
- **§11.9 cross-doc consistency heuristic.** Treat literal phrases / version
  numbers / package names appearing in multiple docs as a single surface
  during a change. Grep for divergence at PR time.
- **§12 architectural patterns section opened.** §12.1 names the three-tier
  auth pattern (shell-UX / core-protocol / secret-store) bound by the MCP
  roadmap ADR. Future named patterns add here; one-off decisions stay in
  DECISIONS.md.
- **Auto-review workflow** runs on every PR with five mechanical checks
  (§7 template, CHANGELOG, ADR format, cross-doc consistency, stealth-
  residual class). Lifts the mechanical-check load off Architect review.

## What's next (Sprint 2 lane preview)

Sprint 2 runs several lanes in parallel — the design docs from Sprint 1 each
opened multi-piece arcs that can advance independently. Likely candidates
(exact lane list is the Architect's call):

- **Voice ambient Piece 1** (`feat/voice-boot-greeting`) — smallest piece
  of the voice-ambient arc, immediate UX win.
- **Voice ambient Piece 2** (`feat/voice-always-on-vad`) — silero-vad
  integration, needs the privacy-posture ADR alongside.
- **Voice extensibility Piece 1** (`feat/voice-tool-registry`) — load-
  bearing for the rest of the voice-extensibility arc.
- **MCP arc Piece 1** (`feat/raven-mcp-client`) — client substrate.
  First consumer of the §12.1 three-tier auth pattern.
- **Vision arc Piece 2** (`feat/vision-gesture-watcher`) — builds on PR
  #43's capture node.
- **Vision arc Piece 3** (`feat/raven-gesture-actions`) — gesture →
  action map in raven-core.
- **`chore/governance-batch-2`** — pick up the next round of §10
  codifications and any heuristic-9 cross-doc fix-ups from Sprint 1's
  rough edges (tool count drift especially).
- **`fix/raven-tool-count-mismatch`** — already on the post-Sprint-1
  punch list; lift the tool-count enumeration out of the system prompt
  string into a computed value so additions don't drift.

The eight-lane shape is plausible if Sprint 2 runs as long as Sprint 1
felt (~one calendar day) or as relaxed as it actually was (~16h elapsed).
Lane sequencing is constrained by the dependency ordering each design doc
encodes — most pieces are Piece-1-blocked within their arc, so parallel
breadth is real (six arc-Piece-1s in parallel) while depth is limited.

## Open questions

- **Voice tool count subtlety** — resolved post-Sprint-1 via
  `fix/raven-tool-count-mismatch`. The in-prompt numbered tool list was a
  hand-maintained literal that drifted when weather added two tools in PR
  #42. The fix lifts the enumeration to a computed source-of-truth so the
  prompt stays in sync as tools are added.
- **Refactor opportunity: `registerNode()` abstraction** — queued for
  post-Sprint-2 consideration. Sprint 1 surfaced that adding a data node
  touches at least four shell-side files (`paths.ts`, `nodeManager.ts`,
  `coreManager.ts`, `secrets.ts`) with implicit per-node conventions
  (`AETHER_DATA_DIR` in `extraEnv`, `MESH_<NODE>_SECRET` env var name).
  PR #45 reconciled both weather and vision against these conventions
  after the fact. A `registerNode({ id, entry, dataDir?, secret })`
  abstraction would collapse the per-node wiring into one call site. Held
  back per the §15 rule of thirds — wait for the third instance before
  extracting. Weather and vision are the second and third data-shape
  nodes (counting host_notifications, news_feeds, finance, digest as the
  prior population); the abstraction has earned its weight if a fourth
  lands in Sprint 2 with the same wiring shape.
- **Future arcs reserved but explicitly out of scope** — voice-created
  tools (new tool *bodies* by voice, not just composing existing ones),
  tool versioning, cross-user / cloud sync of automations + modes,
  per-tool permission gates, MCP server hosting (Aether is a client
  only), Microsoft 365 / Outlook ecosystem, local-LLM mediation of
  authenticated data, multi-account MCP, Apple HealthKit / iCloud.
- **Substrate buildout** — Director's home-box work ran in parallel to
  Sprint 1 off-repo and has not yet intersected the PR ledger. The
  substrate-vs-workspace split (`MASTER_SYNTHESIS.md` §2) becomes
  load-bearing once a hardware substrate is online; until then the
  workspace half carries the whole product surface.
