# Aether Governance Log

This file holds Aether's accumulated operations-rules entries — the
"Hard Gotchas" originally lifted from `_ingest/` learning and the
governance batches added each sprint. CLAUDE.md links here for the
full historical record. New governance batches append below the
existing entries rather than expanding CLAUDE.md.

## 10. Hard Gotchas (lifted from `_ingest/` learning)

These are scars. Internalize them before they happen again.

### Electron / macOS

- **`jsdom` pinned at v24.** v25+ pulls ESM-only deps that Electron's CJS `require()` cannot load. If you bring `@mozilla/readability` or similar, `jsdom@24` is the ceiling. Pin it explicitly.
- **Don't call `dock.hide()` on macOS Sequoia.** It strands the tray icon. Leave the dock visible even for menu-bar-style apps. (Pulse hits this; check `_ingest/Pulse/src/main/index.ts`.)
- **Splash → renderer-ready → reveal sequencing is load-bearing.** Don't move heavy initialization out of the splash gate. Cold start without it shows compositor jitter. See `_ingest/Pulse/src/main/index.ts:189-213` for the reference pattern: splash held until all schedulers warm, 180s watchdog, renderer signals ready, 2-frame compositor settle, then reveal.
- **`visibilitychange` alone is wrong for tab-pause logic.** It misses window occlusion. Listen to `blur` and `focus` too, treat any-of-three as the canonical "active" signal.
- **No `backdrop-blur` on viewport-filling overlays.** Composition cost is steep in packaged builds; works fine in dev but kills perceived performance in production. Use translucency via `rgba()` backgrounds instead.
- **No `animation: ... infinite` CSS rules.** Permanent CSS animations cause visible jitter under macOS screen-sharing. Use `requestAnimationFrame`-driven `scrollLeft` for marquees and similar.
- **`titleBarStyle: 'hiddenInset'` + custom top nav = traffic-light clash.** Hiding the title bar lets renderer content extend to the window's top edge, but macOS still draws the red/yellow/green window buttons in the top-left (~12–80px). Any UI element placed in that region (top nav, header bar) collides. Pad the left side of the top region by 80px on macOS, 0 elsewhere. Also make the empty padding region `-webkit-app-region: drag` so users can grab the top to move the window (hiddenInset disables the default dragging surface); per-button `-webkit-app-region: no-drag` keeps clicks working.
- **`spawnSync` in Electron main freezes the UI.** Any synchronous `child_process` API in Electron main blocks the renderer for the full duration of the child. A 30s pip install via `spawnSync` produces a black screen + network-service crash. Use async `spawn` returning a Promise. Anything that could exceed ~100ms must be async. Source: PR #9, commit `3ff7186`.
- **Electron main on macOS has stripped PATH.** GUI-launched Electron doesn't source `.zshrc` / `.bashrc`, so `pnpm`, `python3`, `node`, and any user-installed bin may not be findable via `command -v` or unqualified path lookup. Resolve via `$SHELL -lic 'command -v <bin>'` to inherit the login-shell's PATH. Pattern used in `shell/electron/main/services/python.ts` (mesh) and `ravenDaemonManager` (voice). Source: PR #9 commits `1d29df6` → `37bf450`; same root-cause as mesh PR #10's `python.ts`.

### Subprocess protocols / structured channels

- **Stdout pollution breaks JSON-RPC daemons.** Any subprocess speaking a structured-text protocol over stdout (JSON-RPC, JSON-lines, NDJSON, etc.) must NEVER share that stream with human-facing output (prompts, debug logs, progress messages). Human output goes to stderr or a separate log file. The "message > " bug in PR #9 was an interactive CLI prompt — written without a newline — gluing itself to subsequent JSON status events on stdout and breaking JSON.parse on the daemon side. State transitions were silently dropped. Source: PR #9 commit `9b6bd6a`.

### Schema migrations

- **Schema migrations: column-dependent indexes must live in the migration step, not the initial CREATE block.** `CREATE INDEX IF NOT EXISTS` still fails when the column doesn't exist yet on a pre-migration database. Apply ALTER TABLE first inside the migration step, then CREATE INDEX inside the same migration step. Source: PR #16's mid-implementation catch — first draft put the `idx_articles_category_published_at` index alongside the initial `CREATE TABLE` block; failed on pre-migration DBs because the `category` column didn't exist yet. Caught by smoke-testing the migration against a real v0.3.0 DB before commit. Commit ref: `8cb3aad` (PR #16).

### Voice / audio

- **Mic-during-playback creates acoustic echo loops.** Voice AI listening continuously while the speaker plays will hear its own output, treat it as user speech, fire false interruptions (cutting itself off mid-sentence), and generate responses to its own echo — producing a cycling loop. Until proper AEC is wired up (Apple's `voiceProcessingIO` on macOS is the canonical answer), gate the mic during playback via a monotonic "playback-until" timestamp. Trade-off: no barge-in. Source: PR #9 commit `06963f5`; barge-in fix queued as `fix/voice-barge-in` follow-up.

### Security / NEXUS lessons

These are from `_ingest/NEXUS/AUDIT.md`. **Do not lift NEXUS code unfixed.**

- **No auth on endpoints.** Every API route, the WebSocket terminal, and the cell engine in NEXUS has zero authentication. If you lift a route, you add HMAC envelope verification (mesh-style) or local-loopback-only binding plus a secret.
- **Docker socket mount = root.** If you ever introduce Docker-based agent isolation, the Docker socket does *not* get mounted into a container that runs untrusted code.
- **Path traversal: `startsWith('/workspace')` is insufficient.** Use `path.resolve` + a boundary check (`resolvedPath.startsWith(workspaceRoot + path.sep)`). Reject symlinks that escape the boundary. Test with `..` segments and absolute paths.
- **Atomic writes for state files.** Anything load-bearing (manifests, agent state, DB files) must use write-temp-then-rename, never truncate-and-write. `agents.json` mid-crash deletion is a real NEXUS bug.
- **No symlink-following file APIs** unless explicitly intended.
- **YAML injection in user-editable YAML files.** Use `yaml.safeLoad` / `load` with a schema-restricted constructor.

### Build & dependency hygiene

- Use `pnpm` (not `npm`/`yarn`) unless the user says otherwise — it's what VIEWER uses, and the workspace structure suits monorepos we'll evolve into.
- Pin major versions of Electron, React, Tailwind in `package.json` (`^` ranges OK; no `*` or unbounded). Major-version bumps are their own PRs.
- Don't `pnpm add` heavy native deps (sqlite, sharp, node-pty) without flagging in the PR. They affect electron-builder and signing.
- TypeScript strict mode on. No `any` without a comment explaining why.
- **Submodule adds vs. .gitignore.** Modern git refuses `git submodule add <url> <path>` if `<path>` is matched by .gitignore (no override short of `-f`, and `-f` is worse practice than reordering). When introducing a submodule at a previously-ignored path, remove the .gitignore entry first, then add the submodule. Discovered in PR #2.

### Worktrees and the GitHub CLI

- **`gh pr merge --delete-branch` errors out when run from a feature worktree.** The remote merge completes, but gh's client-side cleanup tries to `git checkout main` in the current worktree to delete the local branch — which fails because `main` is already checked out in the primary worktree (git won't check out the same branch in two worktrees). Workaround: either run `gh pr merge` from the primary `~/homeOS` worktree, or drop `--delete-branch` and follow with `git push origin --delete <branch>` to clean up the remote independently. Local branch cleanup happens during worktree teardown (`git branch -D <branch>`). Bit twice — PR #12 (gotchas docs) and PR #18 (schema-migrations docs).

### Gemini Live: system_instruction is set once per session

The Gemini Live API's `system_instruction` field in `LiveConnectConfig` is set at session start and cannot be hot-swapped per turn. Sending a new `LiveConnectConfig` mid-session has no effect; the original system_instruction remains in force for the lifetime of the session.

This came up in PR #25 (voice session context). The original design intended to inject per-turn conversation context via system_instruction swap. That doesn't work. The workaround is to attach session context as `_session_context` in the FunctionResponse body that Gemini reads alongside the tool output. See `daemons/raven-core/raven_core/tools/__init__.py` for the working pattern.

When designing future voice tools that need per-turn context:
- Don't assume system_instruction is mutable mid-session
- Attach contextual data to FunctionResponse bodies
- For state that needs to persist across multiple turns without a tool call mediating, the only options are: (a) restart the session with new system_instruction, or (b) feed context through the next tool result

### Identity renames and stealth-residual surfaces

- **Workflow YAML is a stealth-residual surface during identity renames.** GitHub Actions YAML (`.github/workflows/*.yml`) and any CI config that references package names, workspace filters, or directory paths can silently carry the old identity past a rename. `pnpm --filter <pkg>` does NOT fail when the filter matches zero packages — it logs `No projects matched the filters` and exits 0. A renamed workspace package (`@homeos/* → @aether/*`) with an un-updated `pnpm --filter @homeos/foo build` step turns into a no-op CI green check that masks the rename gap. Audit every workflow YAML during an identity rename PR; a green CI run after a rename is not evidence the rename is complete. Codify in DECISIONS.md if the rename is multi-PR. Class: any string-key that the build/CI/runtime uses to resolve the identity is a residual surface — package names, workspace filter scopes, env vars, bundle identifiers, preload-bridge globals, userData directory names.
- **Stale local `dist/` can mask workspace resolution failures that CI catches.** After a workspace rename (or any change to `package.json` `name:` / `pnpm-workspace.yaml`), a previous build's `dist/` plus a populated `node_modules/.pnpm` store may resolve imports locally even though the new identity isn't actually wired through. CI starts from a clean state, hits the gap, and fails — by which point you've already opened the PR claiming "works locally." After a rename, do `rm -rf node_modules dist && pnpm install && pnpm -r build` before opening the PR. A passing local build of un-cleaned state is not a smoke test.
- **Identity renames have a long tail of non-code surfaces that get missed if you only update the code paths.** Beyond the obvious source-tree edits, every rename also touches: GitHub Actions workflow YAML (job names, filter scopes, status-check names referenced by branch protection), README badge URLs (image + link, both directions of `homeOS → Aether`), README quickstart commands (clone URLs, `cd` paths), documentation cross-references (links between markdown files), DECISIONS.md historical ADRs (left verbatim by policy — do NOT rewrite past entries), CHANGELOG entries from prior versions (also verbatim), `.env.example` and any sample config files, the project's own self-description in `package.json` `description` fields, electron-builder `productName` and `appId`, preload bridge globals (`window.homeOS` → `window.aether`), userData directory migration (one-time idempotent rename on first boot — see PR #31 lineage), and the project's display name in the voice system prompt. Build a per-rename checklist; the rename PR's self-review under §7 should walk it explicitly. The class to internalize: identity lives in many side-channels, not just source code.

### Mesh-node registration is a five-file pattern

Adding a new mesh node requires touching, at minimum, five files: `manifest.yaml` (surface declarations and edges), `shell/electron/main/services/secrets.ts` (`MESH_<NODE>_SECRET` generation), `shell/electron/main/services/coreManager.ts` (the secret added to Core's env block so Core and the spawner agree), the spawner appropriate to the node's runtime (`nodeManager.ts` for TypeScript nodes; a node-specific `*DaemonManager.ts` for Python nodes), and `.env.local.example` (any new node-facing env vars). TypeScript nodes additionally require a `schemas/` directory of JSON Schema files matching every declared surface — Core hard-fails with `FileNotFoundError` at launch if a manifest entry references a schema file that wasn't written. Missing any one of these produces a confusing runtime symptom (Core can't load the node; the node never spawns; voice tools that wrap the node return undefined) rather than a clean failure at PR review. Discipline: walk the five-file checklist (plus `schemas/` for TS) in the §7 PR body and confirm every file appears in the diff before requesting review — see the binding ADR in DECISIONS.md (2026-05-14).

### GitHub Actions silently accept unknown inputs

An action invoked with a misspelled or stale input key (e.g. `prompt:` where the action's `action.yml` declares `direct_prompt:`) emits a warning annotation but exits 0 with no functional effect — the workflow goes green and the step "ran," but the input never reached the action's code. Auto-review on PR #39 shipped wired this way and the gap only surfaced when PR #40 produced no review. Discipline: when wiring a new action invocation, verify the expected *behavior* (a posted comment, a created artifact, a forwarded message) before treating the wiring as proven. Exit code is necessary but not sufficient.

### Claude GitHub App refuses to validate workflow changes against themselves

The Claude GitHub App will not issue a token for a PR whose workflow file content on the PR branch differs from `main` — the App declines the request as a defense against a PR rewriting its own triggering workflow to elevate privileges. A PR that edits its own auto-review workflow therefore cannot smoke-test the edit on its own branch. Discipline: workflow file changes merge first (use `gh pr merge --admin` to override branch protection when alone on the repo and the change is mechanical), then the next ordinary PR is the first smoke test of the change. Plan workflow PRs as no-ops architecturally; the validation comes on the PR after.

### Python `try: except ImportError` blocks wrapping multiple imports swallow partial failures

A block like `try:\n    from a import x\n    from b import y\nexcept ImportError: ...` whose first import raises leaves *both* `x` and `y` unbound — Python skips the remainder of the try suite at the first exception. The crash arrives much later as a `NameError` at the first use of the second symbol, with a traceback that points at the use-site, not the import. The vision node hit this when `from CoreVideo import ...` failed (CoreVideo is bundled inside `pyobjc-framework-Quartz`, not a standalone PyPI package), silently unbinding a later `NSObject` import in the same block. Discipline: one try-except per import, or import the package whole (`import Quartz`) and reference symbols by attribute access (`Quartz.CoreVideo.kCVPixelFormatType_32BGRA`).

### `.env.local` loading is inconsistent across Aether components

Three Aether components read environment-driven config differently. `daemons/raven-core` loads `.env.local` explicitly via a Python dotenv call at startup. `core/` only sees `MESH_PYTHON` from `.env.local` via a one-line shell shim in its launcher. `shell/electron` has **no** `.env.local` loader at all — env vars reach the renderer only via what was in the GUI-launched process's environment, which on macOS is the stripped login-shell PATH and nothing else. A new node documenting its config in `.env.local.example` will therefore silently fail to receive those vars at runtime depending on which component needs them. Discipline: when introducing an env-var-driven knob, name the consuming component and confirm that component already has a loader (or add one in the same PR) before treating the wiring as complete.

### Mesh SDK `Record<string, unknown>` requires index signatures on strict surface return types

The TypeScript mesh SDK's surface-handler return-type slot is `Record<string, unknown>`. A strict response interface like `CurrentWeather` or `Forecast` whose fields are declared explicitly will not assign into `Record<string, unknown>` without either an explicit index signature (`[key: string]: unknown`) on the interface or a cast at the return site — TS treats the absence of an index signature as "this object has only these keys" and refuses the wider assignment. The failure is build-time only; local dev against a stale `dist/` may compile fine while CI from a clean tree fails. Discipline: add the index signature when defining a new strict surface return type, and confirm `pnpm -r build` succeeds from a freshly cleaned tree (`rm -rf node_modules dist && pnpm install && pnpm -r build`) before opening the PR.

### `pnpm --frozen-lockfile` fails when the worktree introduces a new package

CI runs `pnpm install --frozen-lockfile`, which refuses to mutate `pnpm-lock.yaml`. Adding a new workspace package — or any new dependency line in an existing package — without regenerating and committing the lockfile fails CI immediately at install time, before any build/test step runs. Discipline: when adding a new package or dep, run `pnpm install --no-frozen-lockfile` locally, stage `pnpm-lock.yaml` alongside the `package.json` change, and confirm the lockfile is part of the staged diff (`git diff --staged --name-only | grep pnpm-lock.yaml`) before pushing.

### `pnpm -r typecheck` depends on dependent packages' `dist/` already existing

In this workspace, when package A imports `@aether/mesh-node-sdk`, A's typecheck resolves the import via the SDK's compiled `dist/` (per `package.json` `main`/`types`), not the SDK's `src/`. On a clean tree the typecheck fails with `Cannot find module '@aether/mesh-node-sdk'` until the SDK is built first. Discipline: order verification as `pnpm -r build` → `pnpm -r typecheck` → `pnpm -r lint`, in CI and in local pre-PR scripts. Typecheck is not a standalone validation step in this monorepo.

### ESLint `no-unused-vars` rejects underscore-prefixed catch params in CI's locked versions

The convention `} catch (_err) {` to mark an intentionally unused exception value passes locally but trips the `no-unused-vars` rule under the dependency versions CI installs from the lockfile (the rule's underscore-allowlist is configured differently than dev assumes). Workaround: use the parameter-less catch form (`} catch {`), which both modern TypeScript and ESLint accept and which sidesteps the rule entirely. Discipline: prefer parameter-less catch unless the exception value is actually consumed.

### Architect-authored spec drift from the canonical ADR

Implementer specs can diverge from the binding ADR on subtle but load-bearing points — platform identifier, surface name, lifecycle hooks, frame rate, response shape — and the divergence is invisible until implementation hits a contradiction or review surfaces it. The vision-capture spec went through three revisions before implementation matched the ADR's surface contract. Discipline: before writing code, diff the lane spec against the ADR it cites — literal grep of surface names, platform identifiers, lifecycle terms — and surface any disagreement in the PR body or chat *before* implementation, not after. An ADR-vs-spec contradiction caught pre-code is one paragraph; caught post-code is a re-implementation.

### Mesh / voice operational rules

- **Node 22+ required.** The `yahoo-finance2` library explicitly requires Node 22+ and warns on every spawn under older versions. Node 20 caused silent slowness during Sprint 2 smoke testing: 4.5+ minutes per finance poll cycle for 10 tickers, escalating to 10+ minutes for 21 tickers. Aether enforces Node 22+ as baseline via `shell/package.json` `engines` field (`node: >=22.0.0`). New contributors on Node 20 homebrew installs will be unable to install dependencies until upgrading.
- **Voice tool Gemini-declaration pattern.** Every voice tool file in `daemons/raven-core/raven_core/tools/` must include four pieces: `types.FunctionDeclaration` registrations for each callable function, `types.Tool` wrapping of those declarations, a `get_tools()` exporter returning the list of `types.Tool` objects, and a `handle_call_async()` dispatcher routing `FunctionCall.name` to the appropriate handler. Simply defining async functions does NOT register them with Gemini — the four-piece pattern is load-bearing. The mesh_client import is `from ..mesh_client import MeshUnavailable, mesh_invoke` (relative import, NOT `raven_core.mesh`). See `calendar_tool.py` for the canonical pattern.
- **6-file Python new-node pattern.** The new-node pattern doc (`docs/new-node-pattern.md`) shows 5 files as the baseline mesh-node registration shape, but Python daemon-managed mesh nodes also require a `get<Node>MeshConfig()` getter in `shell/electron/main/services/mesh.ts` that returns the node's config object (secrets, env vars, executable path). Total 6 files for Python nodes, not 5. TypeScript nodes managed by `nodeManager.ts` do not need the mesh.ts getter and remain 5-file.
- **Python 3.14 + pyobjc compatibility.** The `pyobjc-framework-*` libraries must be pinned as `>=10.0` (not `==10.3.1`) to remain compatible with Python 3.14. Version 10.3.1 has no pre-built wheel for Python 3.14 and source-build fails due to setuptools 81+ removing `pkg_resources` which pyobjc's setup.py relies on. The `>=10.0` range lets pip select the appropriate wheel for the local Python version. Applies to any node using EventKit (calendar, reminders) or other macOS frameworks.
- **MeshNode API uses `.on()`, not `surfaces=` kwarg.** The Python MeshNode constructor does NOT accept a `surfaces=` kwarg. Construct with `MeshNode(node_id=..., core_url=...)`, then register handlers via `node.on("surface_name", handler_function)` for each surface. Additionally, `node.start()` returns immediately and does not block; a keep-alive loop (`while True: await asyncio.sleep(1)`) is required after `node.start()` to prevent the daemon from exiting. Missing either the `.on()` registration or the keep-alive loop produces a node that spawns and immediately exits, leaving Core unable to reach the surfaces.
- **`EKEventStore.authorizationStatusForEntityType_` is a class method.** When checking EventKit authorization status for Calendar or Reminders access, call `EKEventStore.authorizationStatusForEntityType_(...)` as a class method, not `store.authorizationStatusForEntityType_(...)` as an instance method. The pyobjc binding reflects the Obj-C `+` (class-method) prefix; calling it as an instance method produces a runtime AttributeError. This applies to both the calendar and reminders nodes.
- **TypeScript mesh nodes require build after fresh pull.** TypeScript mesh nodes (system_info, finance, news_feeds, weather) compile to `dist/` directories outside of `node_modules` and do not auto-rebuild on `pnpm install`. After cloning or pulling a fresh `main`, run `pnpm -r build` before starting Aether or the mesh will fail at node-spawn time with "system_info dist not found at /Users/.../dist/index.js". Future arc: a postinstall hook or build-if-missing gate in `nodeManager.ts` may automate this; for now it is a manual discipline.

---

## Sprint 4 — Process Discipline Codification (post-#67)

Sprint 4 accumulated more operational lessons than any prior sprint. This appendix records the rationale behind §13 of CLAUDE.md and its supporting infrastructure (`docs/implementer-prompt-template.md`, `.claude/agents/`, `.claude/skills/`, `.github/`).

### Why a dedicated process lane

Across PRs #64–#67 and several days of varying API conditions, the same friction patterns recurred:

- **Read-phase stalls.** Sessions hit hostile-API windows during the initial multi-file read, before any write occurred. #65 and #66 required manual completion. #67 was resolved structurally by pre-staging the splash code inline — landed in 40 minutes after three prior failed attempts. Lesson: when API is hostile, the read phase is the bottleneck; pre-staging file content in the prompt removes the failure mode entirely.

- **Wrong-scoped lanes.** Twice in Sprint 4, the Architect drafted a prompt without first grepping the codebase. Both lanes had to be re-scoped mid-session. Pre-flight grep by the Architect, captured explicitly in every prompt, makes this failure mode visible before the Implementer starts.

- **Choke-file context drag.** `DECISIONS.md` (2148 lines) and `CHANGELOG.md` (1036 lines) became the new context-budget choke points after the §10 extraction in #64. Every prompt touching either now requires targeted grep + view line_range, never full-read.

- **Verify-clean stall.** Sessions consistently stalled between running verify and opening the PR — sometimes 5+ minutes silent. Resolved by separating into two explicit skills (`verify-build` then `ship-it`) with a Director confirmation gate between them.

- **State preservation across time gaps.** Director returning hours or days later asked "where are we"; reconstructing state from memory + git was fragile. Architect now writes `_session_state.md` (gitignored) at productive session ends.

---
## 2026-05-21 — Wave 0 lessons

### Smoke validation as merge gate for macOS native-app boundaries
PR #102 (macos_mail AppleScript scope) shipped with clean verify + clean diff review, but the fix was architecturally sound while still being insufficient against a 97k-message inbox: Mail.app's AppleScript bridge fundamentally cannot evaluate any collection query against a degraded inbox in reasonable time, regardless of query shape. Verify-clean + diff-review is necessary but not sufficient for any lane touching a macOS native-app boundary (Mail, Messages, Calendar, Reminders, Notes, Music, Maps, etc.). Smoke validation on representative production data is the merge gate going forward, not just CI green. Architect bears responsibility for insisting on smoke validation before authorizing merge.

### Substrate identity as architectural primitive
Aether received its own iCloud account on 2026-05-20, mirroring the RAVEN precedent (RAVEN had its own iCloud on a Mac Mini). This isn't an environmental workaround — it's the shape of what Aether is. Apps borrow their user's identity; substrates have their own. The eventual home-substrate state (always-on Mac Mini, peripherals) inherits this Apple ID. Every personal-data node going forward should be designed with an optional account-filter so it can scope to Aether's accounts rather than mixing identities. Dual-account is the steady state, not single-account.

### AppleScript timeout diagnosis pattern
When a Mail.app or Messages.app daemon reports timeout failures, the diagnosis is NOT necessarily a query-shape problem. The bridge may be fundamentally unresponsive due to indexer state, iCloud sync state, or large dataset state. Diagnostic order: (1) test trivial property access via `osascript` directly (`name of inbox`); (2) test bounded collection query (`messages 1 thru 5 of inbox`); (3) test `whose`-predicate query. If even (1) times out, the bridge is degraded — no query-shape fix will help. Document the limitation, file a follow-up lane that bypasses the bridge (Maildir-direct-read for Mail, equivalent for Messages), do not attempt further AppleScript engineering against that environment.

### attributedBody as default storage for outgoing iMessages on modern macOS
chat.db's `message.text` column is increasingly empty for outgoing iMessages from modern macOS; content lives in `message.attributedBody` (binary NSAttributedString blob, typedstream format). PR #74's inherited filter `WHERE text IS NOT NULL AND text != ''` silently drops these rows. Future macos_messages work must accept rows where text-is-empty + attributedBody-is-present, and decode the typedstream to extract human-readable content. This is not an edge case; it's the modern default.

### Subagent rationale

The read-phase problem is structural: Implementer's main context fills with raw file content during reads, then the same context has to hold the write plan. On hostile-API days the read phase stalls before the write begins. The subagent split fixes it:

- `aether-explorer` (Haiku) reads in isolated context, returns a summary, never writes.
- `aether-implementer` (Opus) is the canonical builder; first action is a write.
- `aether-reviewer` (Sonnet) runs the §11 walk-through before the PR opens.

### Skills rationale

The repetitive verify+commit+PR dance was being rewritten in every prompt. Extracting `verify-build` and `ship-it` makes the sequence canonical and resolves the stall pattern via explicit two-phase commit with a Director gate.

### GitHub Issues / PR template rationale

Sprint 4 backlog lived in chat history and `_session_state.md` — neither visible to a returning Director or future Implementer session without onboarding. Issues make backlog repo-public. PRs with `Closes #N` close the loop automatically and produce navigable history.

## Sprint 4 Wave 2 lessons banked (2026-05-18 through 2026-05-20)

1. **`_ingest/` patterns are facts about source repos, not Aether facts.**
   Drafted Wave 2 prompts inherited three structural assumptions from
   Pulse (BrowserWindow IPC broadcast, global migration registry,
   shell-services polling) that don't apply to Aether's daemon-per-node
   architecture. Implementer caught two of the three in pre-flight on
   #73; the third was caught manually during reshape. Rule: any lane that
   references `_ingest/` patterns must read at least one existing Aether
   node (canonical: `nodes/news_feeds/` or `nodes/clipboard_history/`)
   alongside any pattern hoist.

2. **aether-explorer scope ≤2 dimensions per invocation.** A 6-dimension
   explorer call during Wave 2 prep ran for ~10 min, then stalled on its
   second invocation, losing everything (subagents return only at end,
   per §13). Rule: explorer calls are bounded; if a question has more
   than 2 dimensions, split into multiple calls or read directly.

3. **Subagent stalls lose all work; main-session stalls preserve partial.**
   A subagent that stalls mid-execution returns nothing to the caller.
   A main-session CC that stalls leaves partial writes in the worktree
   (sometimes substantial — see lesson 10). Rule: when the read phase
   is fragile, prefer main-session over subagent.

4. **`git status` on a worktree is the first triage move, not the last.**
   After PR #74's CC session "stalled," we assumed nothing was written.
   Days later, `git status` on the worktree revealed 13 file touches
   completed — the session had finished writes but hadn't reached
   verify-build before the stall. Resulted in landing #74 in ~20 minutes
   from a state we'd written off. Rule: always `git status` worktree
   before assuming a stall produced nothing.

5. **New CHOKE FILES discovered.** `manifest.yaml` (~530 lines, growing
   ~25 per node), `docs/new-node-pattern.md` (~827 lines),
   `shell/electron/main/services/coreManager.ts` (~250 lines, growing
   ~10 per node), `.github/workflows/ci.yml` (~90 lines high-value).
   Added to §13.3 CHOKE FILES list.

6. **`pnpm install` MUST run before `git add -A` in ship sequences.**
   PR #74 failed CI with `ERR_PNPM_OUTDATED_LOCKFILE` because the
   manual ship script staged before installing, leaving the lockfile
   update unstaged. Codified in `.claude/skills/ship-it/SKILL.md`.

7. **`pnpm -r typecheck`, not just `pnpm typecheck` in shell.** PR #75
   passed local verify (shell-only typecheck) but failed CI when
   `pnpm -r typecheck` exposed unresolved types for the new
   `@aether/macos-applescript` workspace package. Codified in
   `.claude/skills/verify-build/SKILL.md`.

8. **Three hardcoded package lists trap new SDK-shape workspace packages.**
   `shell/package.json` prebuild filter, `.github/workflows/ci.yml`
   pre-build step, and `shell/electron/main/services/staleSpawns.ts`
   cleanup entries each maintain a hand-curated list of packages.
   Adding `@aether/macos-applescript` missed all three; the CI list bit
   #75. ADR proposes `pnpm -r build` before `pnpm -r typecheck` as the
   forward path (see DECISIONS.md 2026-05-20).

9. **Manual completion pattern is a viable hostile-API fallback.** Used
   three times in Sprint 4 (clipboard #73 manual, messages #74 recovery,
   mail #75 mid-lane recovery). ~30 min per node, Architect-dictated
   cat-heredocs + Python patches. Documented in `docs/manual-completion.md`.

10. **macOS case-insensitive FS + case-sensitive git index can shadow files.**
    Encountered during Wave 1 cleanup when a lowercase file existed
    alongside an UPPERCASE version in the git index. Watch for any
    rename that only changes case.


---

## 2026-05-25 — Sprint 5 lessons banked

### Manual completion playbook expanded to seven PRs / five shapes
Hand-completion is no longer a single pattern; it's a kit. Shapes documented across PRs #65, #66, #110, #112, #113, #114, #115:

1. **Implementer-wrote-Director-shipped** (#65, #66) — CC drafted code, Director ran verify-build and shipped manually.
2. **Implementer-stalled-Director-finished** (#110, #112, #113 verify) — CC drafted partial code or stalled mid-write; Director completed remaining edits and shipped.
3. **Hand-written documentation lane** (#114) — no CC at all. Architect drafted prose in chat, Director pasted to disk, committed and shipped. First non-code application of the playbook.
4. **Hand-edit code lane spanning two calendar days** (#115) — three rm -rf + surgical edits over two evenings/mornings. Uncommitted branch state preserved on disk between sessions. Validates: hand-edit lanes don't need single-session completion.
5. **Architect-Director hand-completion after both CC sessions stalled** (#113) — both Implementer sessions hit ECONNRESET mid-write. Final state was assembled across the two stalled sessions' partial outputs. Director ran verify-build, manually-shipped.

Across all five shapes: files persist on disk between sessions; resume prompts are 30–40% the size of original prompts; the §7 canonical PR body discipline holds regardless of session count.

### ECONNRESET pattern observed but uninvestigated
Two consecutive CC sessions during PR #113 stalled with clean network drops at retry 10/10 after ~17 minutes and ~23 minutes into the write phase. Same machine, same network, sessions spaced ~30 minutes apart. Different mechanism from the retry-storm pattern documented previously (those climb 5/10 → 8/10 over minutes). Possible causes (unverified): status.claude.com incidents during the windows, macOS network stack hiccups on long-running HTTP streams, VPN/proxy interference, request-size thresholds, local egress flakiness. Deferred to Sprint 5.5 cleanup (Phase 2 of Sprint 6): check status pages historically for the affected windows, profile network during a long write phase, decide on mitigation.

### Tight explorer briefs hold value
Explorer overhead dropped ~60% by tightening briefs from 7 subtasks (PR #107) to 3 subtasks (PR #113). Brief discipline: name 3-4 specific reads, no open-ended "find anything relevant" framing, no asking the explorer to also draft conclusions. Implementer reads the explorer summary as raw input, draws its own conclusions. CLAUDE.md §13 codifies.

### Implementer-side decision authority pays off
When prompts give the Implementer explicit local authority ("pick whichever you can implement cleanly; document choice in PR body") instead of pre-deciding every detail: choices are good, decisions arrive with reasoning attached. PR #113 picked Strategy A (radial single-ring) over Strategy B (concentric rings) with documented reasoning in RadialLayout.tsx top comment + PR body. Architect's prompt explicitly left the choice open. Worth a CLAUDE.md §13 update describing this as the preferred pattern: pre-decide what's load-bearing, leave non-load-bearing choices to Implementer.

### §11 pre-PR heuristics catch real bugs
- PR #113 §11.4 walk identified the AppDefinition `name` vs `title` discrepancy (Architect's resume prompt said `title`; Implementer caught the truth from the actual interface).
- PR #115 §11.6 walk identified the CHANGELOG insertion logic bug in `[Unreleased]` sections with multiple subsection blocks.

Each catch saved a fix-forward PR. §11 is paying for itself.

### CHANGELOG-in-multi-subsection-[Unreleased] gotcha
The "insert before next `## [` heading after `[Unreleased]`" logic is broken when `[Unreleased]` already has multiple subsection blocks (`### Added`, `### Changed`, `### Fixed` all present). Naive insertion puts new content at the bottom of `[Unreleased]` rather than inside the appropriate subsection. Hit on PR #115; fix took a two-step Python edit. Correct logic: "find the matching subsection within `[Unreleased]`; if it exists, append the bullet there; if not, create the subsection right after `### Added`." Banked as CLAUDE.md §10 entry.

### `pnpm install` after new-workspace-package merge
Git rebase brings `package.json` + lockfile but doesn't materialize `node_modules` for new workspace packages. Hit on the main worktree after PR #111's `nodes/mesh_introspection/` package landed (build broke until `pnpm install` ran). Avoided preemptively for PR #113. Banked as CLAUDE.md §10 entry: "After merging a PR that adds a new workspace package, run `pnpm install` from any worktree picking up the change."

### AppDefinition `name` not `title`
`shell/src/lib/app-definition.ts` exports the AppDefinition interface; the display label field is `name`, not `title`. Architect resume prompts mistakenly referenced `title`; Implementer caught it on PR #113. CLAUDE.md §10 entry.

### Bundle-size as deletion-lane signal
PR #115 dropped renderer JS by ~39% (1,012 KB → 622 KB) and CSS by ~21% via three content-app removals. Future deletion lanes should report bundle delta in PR body; serves as a smoke gate confirming the deletion actually took effect rather than leaving dead references behind.

### Roadmap doc bridges sprint handoffs
This Architect chat's handoff doc referenced `docs/agent-platform-roadmap.md` as if it existed; it didn't (prior architect named-but-never-wrote). PR #114 closed the gap. Future Architect chats inherit a real anchor: sprint direction, ADRs, six-piece arc, failure modes, candidate themes beyond Sprint 20. Cost was one hand-written PR; benefit accrues every chat-to-chat handoff hereafter.

### Substrate-stays-human-architected ADR formally recorded
Roadmap doc (#114) described the ADR; DECISIONS.md (this lane) formalizes it. The Architect node never touches broker, manifest edge-graph topology, or the confirmation pattern — at any maturity level, from Sprint 10 draft-only through Sprint 19 self-improvement. Load-bearing for the entire self-extension arc.

### Manifest `description` field convention introduced
New convention: every `manifest.yaml` node entry gains optional `description: string`. Three downstream consumers: mesh-viz hover tooltips (Sprint 6 108d), raven voice introspection (Sprint 13 "what can you do?"), Aether-Architect (Sprint 10). Sprint 6 introduces in new sensors; Sprint 6 backfills 17 existing nodes. ADR in DECISIONS.md.

### Voice-as-universal-consumer recognized
Raven's structural position as the only node with edges to every other surface is load-bearing for principal-facing introspection. When "what can you do?" lands at Sprint 13, the answer comes from raven consuming `mesh_introspection.topology` + manifest descriptions, not a separate Capabilities content app. Documented in roadmap doc Personalization Arc.

### 4-phase sprint shape reaffirmed
Sprint = roadmap → cleanup → features → retro. Sprint 4 was 13 PRs over 3 weeks; Sprint 5 was 7 PRs over 5 calendar days. Variance in lane count is a feature, not a bug. Future Architects evaluating "are we on track?" should look at phase completion, not lane count or calendar time. Already in roadmap doc Architectural Anchors.


---

## 2026-05-26 — Sprint 5.5 lessons banked

### `panel.style` values MUST be strings (RAVEN_AVP constraint)
Discovered during the Sprint 5.5 direction-shift recon on `R-A-V-E-N-delegate/RAVEN_AVP`. The Swift AVP client decodes `panel.style` as `[String: String]?`; a non-string value (number, bool, null) silently kills the entire `SceneMessage` decode — the whole frame drops, no error surfaced client-side, the AVP shell just doesn't render.

The constraint is documented in `RAVEN_AVP/server/generators/pulse_explainer.py` as a CRITICAL inline comment (commit 382611c in that repo) but is NOT obvious from the SceneDoc schema in `docs/architecture.md` or the Pydantic models in `scene_doc.py`.

**Implications for Aether:**
- The visualizer mesh node (Sprint 6.4) must coerce all `style` values to strings before POSTing. Numeric styles like `font_size: 14` become `font_size: "14"`. Booleans become `"true"/"false"`.
- The macOS shell scene subscriber (Sprint 6.3) similarly must handle stringified style values when rendering.
- Worth a runtime assert in the visualizer node to fail-loud rather than fail-silent.

**Banked here** rather than in CLAUDE.md §10 (which is a stub pointing to this log) per the existing convention. The Sprint 6.4 lane spec will reference this entry directly so the Implementer prompt surfaces the constraint at lane time.

### Direction-shift PR is a new lane shape (banked from PR #119)
PR #119 introduced a new lane pattern: roadmap doc rewrite + ADR cluster as the deliverable, in direct response to a strategic conversation that surfaced a pivot. Pattern:

1. Architect-Director discusses strategic shift in chat
2. Architect drafts: new roadmap doc + new ADRs + retro addendum + amendments to obsolete ADR references
3. Hand-written documentation lane per §13.10 shape 3 (no CC session)
4. PR lands canonically before any code lanes fire against the new direction
5. Subsequent sprints execute against the new doc

Differs from §13.10 shape 3 (hand-written documentation lane) only in trigger: shape 3 is for routine sprint cycling (retros, roadmap updates between sprints); direction-shift PRs trigger on strategic pivots that re-shape the multi-sprint trajectory. Same mechanics; bigger stakes.

The discipline that makes direction-shift PRs land cleanly:
- Pre-flight recon on any external system being integrated (PR #119's RAVEN_AVP source-read was load-bearing for getting the architecture right)
- Multi-ADR PRs are appropriate when the ADRs reference each other — splitting creates intermediate states with dangling references
- Amendments to obsolete ADRs in the same PR keep DECISIONS.md cross-doc-consistent (PR #119 amended the manifest-description ADR in the same commit as the new direction-shift ADR)
- The roadmap doc is the canonical anchor; everything else (CLAUDE.md, DECISIONS.md, retro docs) follows from it

**Worth a CLAUDE.md §11 candidate heuristic** at next retro: "When a strategic pivot surfaces in conversation, the next lane is a roadmap-rewrite PR. Do not fire code lanes against an undocumented new direction."

### Architectural anchors are a doc-side count
The roadmap doc's "Architectural anchors" section grew from 7 to 8 in PR #119 (added: data-layer/presentation-layer split). The Sprint 5 retro's roadmap doc had 6 anchors; PR #114's roadmap (Sprint 5) added the 7th (4-phase sprint shape); PR #119 added the 8th. Each anchor represents a load-bearing architectural commitment that future Architect chats inherit without re-deriving.

The anchor count grows by ~1 per major sprint or per direction shift. If it ever doubles in one PR, that's a signal the PR is doing too much architectural work and should be split. Bank for §11 candidate heuristic.

### Inter-shell substrate drift is a forward-looking failure mode
New failure mode banked in PR #119's roadmap rewrite. Mode: macOS and AVP shells consume the same mesh contracts; a contract change made for one shell breaks the other. Doesn't manifest until Sprint 17 when the AVP shell starts active dev, but the discipline starts now — Sprint 6+ contract changes should be reviewed with both-shells-in-mind. If contract changes silently break one shell, the failure mode is active.

**Detection signals once Sprint 17 active:**
- Scene server logs showing `SceneMessage` decode failures (Pydantic validation errors)
- Panels POSTed by the visualizer that render in one shell but not the other
- Cross-shell smoke tests divergence

Worth a Sprint 16 (1.0 stabilize) discipline item: stand up a "both shells smoke" gate that becomes mandatory at Sprint 17.

### Presentation-layer creep into mesh is the easier-to-violate failure mode
The other new failure mode from PR #119. Pattern: temptation to add a rendering hint to a mesh surface ("just a display color field on this sensor") because it would make the visualizer's job easier. Easier to violate accidentally than the substrate-erosion or inter-shell-drift modes.

**Boundary test from the Aether-is-data-layer ADR:**
- A mesh sensor's surface schema gains a "preferred display color" — wrong
- The scene server gains direct read access to a mesh surface — wrong  
- A second mesh node (besides visualizer) starts POSTing to the scene server — wrong
- The visualizer node grows purely-presentation logic (e.g. dark-mode awareness) — wrong (belongs in the shell)

The ADR explicitly addresses what the ADR does NOT forbid: semantic categorization (like `category: Sensor`) is fine even if visualizer uses it for layout decisions. The rule: meaningful in mesh AND consumed by visualizer = OK; purely presentation = wrong.

### Substrate-vs-renderer split paid off twice in Sprint 5.5
Validated as a pattern. PR #118 (manifest description threading) was the first test — substrate kept, mesh-viz hover discarded mid-flight. PR #119 (direction shift) is the second — content-app paradigm archives in Sprint 6.1, mesh substrate unchanged.

**The pattern's value:** when direction shifts, the substrate work outlives the renderer work. Sensors, broker, manifest, signed envelopes, categorization, descriptions — all survive Sprint 5.5 untouched. Content-app code (~1500-2000 lines) goes to `_archive/` in Sprint 6.1 with no impact on the rest of the system.

**Generalizable heuristic for future direction shifts:** when in doubt about whether a piece of work survives a possible future pivot, ask whether it's substrate (data + protocol + invariants) or renderer (presentation + UI + ergonomics). Substrate survives more shifts than renderer.

### Pre-flight recon on external dependencies pays off
PR #119's RAVEN_AVP source-read (README, architecture.md, scene_doc.py head, pulse_explainer.py, requirements.txt) was load-bearing for getting the integration architecture right. Without the recon, the visualizer-node design would have been guessing at the scene server's API surface.

**Banking as a §13 heuristic:** before drafting roadmap material that integrates an external system, do a Pulse-style read pass first. Cost: 10-20 minutes. Benefit: roadmap doc is grounded in real upstream contracts, not approximation.

Same heuristic applies to integration PRs (Sprint 6.2 vendoring RAVEN_AVP as a submodule will need a deeper read of `scene_registry.py`, the POST endpoint variants beyond `/scene/panel/{id}`, and the `mcp_server.py` integration if it's relevant).

### Five ADRs total in DECISIONS.md
Count after PR #119 merge: 5 dated ADRs. Pre-Sprint-5 had 0 dated ADRs (the file existed as a Decision Records log without the date-prefixed format). Sprint 5 retro PR #116 added 2 (substrate-stays-human-architected, manifest-description-convention). Sprint 5.5 PR #119 added 3 (direction-shift, HTTP-everywhere, Aether-is-data-layer) plus an amendment to one of the Sprint 5 ADRs.

Rate of ADR accumulation: ~5 ADRs across one and a half sprints. If this rate sustains, DECISIONS.md is the file most likely to hit the choke-file threshold first (currently 636 lines, will probably exceed 1000 by Sprint 10). Bank for Sprint 10ish retro: consider per-ADR file split (e.g. `docs/decisions/2026-05-26-direction-shift.md`) when DECISIONS.md becomes unwieldy.


---

## 2026-06-03 — Sprint 6 lessons banked

### Full-stack worktree operational notes (consolidated, 5 lessons)
A fresh worktree is not a fresh clone — several pieces of local state don't follow `git worktree add`, and each gap surfaced during Sprint 6 as a confusing runtime symptom rather than a clean error.

1. **Submodules don't initialize in fresh worktrees.** Run `git submodule update --init --recursive` immediately after `git worktree add` for any lane touching the scene server (`daemons/raven-avp-server/`).
2. **Gitignored local config doesn't carry into worktrees.** Copy `.env.local` from main for any lane that runs voice (Gemini key). Surfaced in the 6.5 worktree: raven came up healthy but had no key (no `.env.local` → no Gemini session).
3. **Removing a worktree with an initialized submodule requires `git submodule deinit -f <path>` BEFORE `git worktree remove --force`.** The reverse order leaves git in a confused state.
4. **`git submodule deinit` is GLOBAL across worktrees sharing a common `.git`.** After any such removal, re-run `git submodule update --init --recursive` in main, or main loses the submodule too.
5. **Merging a PR that ADDS a workspace package leaves main un-buildable until `pnpm install`.** The `node_modules` links created in the lane worktree don't carry back. Surfaced when main failed to build `nodes/visualizer` post-#126 merge.

Canonical full-stack worktree recipe:
```
git worktree add <dir> -b <branch> && cd <dir> && git submodule update --init --recursive && cp ~/aether/.env.local . && pnpm install
```

### HTML panels require a frame-src CSP allowance (6.3b)
The renderer CSP had no `frame-src`, so html-panel iframes were silently refused under the `default-src 'self'` fallback (blank iframe + a console refusal, no thrown error). Fixed with `frame-src http://127.0.0.1:5180`, scoped to the scene server only. Any future panel pointing at a different local origin needs a deliberate `frame-src` widening. Related locked principle (not yet implemented): iframe script-enabling is a property of ORIGIN (a trusted-origins allowlist), never of the individual panel.

### Merge-first / append-on-404 upsert idiom (6.4)
For stable-id scene panels: try `POST /scene/panel/{id}` (merge); on 404, `POST /scene/panel` (append). One code path covers both first-seed and steady-state re-POSTs; no 409 storms, no separate "does it exist yet?" probe.

### `pkill -f <path>` misses daemon-spawned processes (6.3a / 6.4 smokes)
Children spawned with `cwd` set have argv like `python3 main.py` — the full path isn't in argv, so path-based `pkill -f` patterns match nothing and the smoke "cleanup" silently leaves the daemon running. Kill by PID instead (`lsof -i :PORT` → `kill <pid>`).

### Manual-completion lane shape, now standard (recurred 3× in Sprint 6: #124, #125, #126)
CC drafts clean code but the session ends before commit/smoke. Recovery: verify the build, read the full diff directly (never trust a nonexistent "report"), fix environment gaps, smoke, then commit with a trailer separating authorship (Implementer) from completion (Director). This is no longer a hostile-API fallback — it's a routine Sprint 6 shape. Cross-reference CLAUDE.md §13.10.

### Estimate undershoot extends to wiring-edit counts (6.4)
Recon predicted 5 shell touch points for the visualizer node; reality was 6 — the Core-env secret injection (`coreManager.ts`), needed by EVERY new mesh node, was the missed one. Treat recon counts as soft anchors; new-node lanes should assume the secret-injection edit on top of whatever recon names.

### Voice front door (Sprint 6 headline finding)
Archiving the voice toggle UI (6.1) without a replacement trigger left voice unreachable — raven was healthy, but nothing could start a session. The PLUMBING survived (preload `voice.start/stop`, main `voice:start` IPC, daemon `POST /listen/start`); only the UI died. The deferred 6.5 smoke CLOSED 2026-06-03 via a curl-activated session (`curl -X POST :7433/listen/start`): "show me the mesh" spoken aloud summoned the topology panel. Lesson: when archiving UI, inventory the entry points it was the sole caller of. Ambient voice (the replacement trigger) is the immediate next lane.

---

## 2026-06-03 (evening) — cockpit day lessons

The cockpit day (CLI-as-one-brain, ambient voice, lanes enrichment, and the
first instrument views — #129 through #136) banked six lessons. Several are
spec-discipline rules for the Architect rather than runtime gotchas; they live
here because they recurred across a single day's lanes.

### Intent over mechanism — spec against read code, not log inferences
In a single day, four Architect-stated mechanisms were corrected by Implementers who read the actual code:

- the availability→status hook for re-engaging the mic (#129);
- the text conduit framed as a WebSocket was actually the child's existing **stdin** pipe (#132);
- transcripts were input-only, not bidirectional — output transcription had to be enabled and teed onto the channel for raven's spoken reply to surface as text (#132);
- `setup_complete` never traverses raven's receive loop, so a ready gate hung on it never opens (#134).

The pattern is now locked: a spec should state **intent** plus a **hypothesis** about mechanism; the Implementer verifies the mechanism against the code and flags corrections. That flagging is the desired behavior, not scope creep. Architect rule: spec against read code, not inferences drawn from logs.

### Smoke the bits you ship
Any post-smoke edit invalidates the smoke for the paths it touches. #132's greeting removal shipped on `verify-build` alone; the typed path was believed green but had not actually been exercised after the edit. A green build is not a green path — re-smoke whatever a late edit reaches.

### New-path isolation smoking
A new input path is validated in isolation from the old one — typed-first, zero speech — so a voice artifact can't be mistaken for a typed success. Two smokes read voice artifacts as typed successes. The daemon-side truth is the transcript endpoint (`curl :7433/transcripts`), not the optimistic CLI echo, which acknowledges acceptance (202) rather than completion.

### Pin what you verify behavior against
`requirements.txt` had `google-genai` unpinned, so per-worktree venvs drifted (2.2.0 on main vs 2.8.0 in a views worktree) and each worktree validated a different library. Pinned `==2.2.0` in #134. Rule: any dependency a lane verifies behavior against gets pinned **in that lane** — otherwise the smoke result isn't reproducible across worktrees.

### Every consumer needs an edge — including the shell
The renderer's `mesh.invoke` routes as the `shell` node; the `shell → lanes.status` edge was missing and the mesh correctly denied it (caught and amended mid-smoke in #136). Any new renderer data path is a manifest edge check, exactly like any new node. The shell is not exempt from the edge graph just because it isn't a daemon.

### Hand-edit hotfix shape
#134 shipped as an Architect-dictated, Director-applied edit with an isolation smoke — the fastest correct path for an exactly-diagnosed fix. It extends the CLAUDE.md §13.10 hand-edit family: where shapes 1–5 cover CC-drafted or CC-stalled work, this is the deliberately hand-edited hotfix taken when the diagnosis is precise enough that spinning up a CC session would only add latency.

---

## 2026-06-03 (night) — encore lessons

The encore — a late-night mail root-cause session after the cockpit day —
banked five lessons. Several continue the day's running count of
Architect-stated mechanisms corrected by measurement or read code (the
evening's "intent over mechanism" finding); the rest are verification-honesty
rules that recurred hard enough to bank.

### Measure, don't reason — per-call wall-clock is timed, never inferred
The mail RCA timed an 84s batch and found ~28s/call of bridge overhead — almost all of the wall-clock was transport, not work. Two Architect latency estimates, both reasoned from payload size, were corrected by the measurement; these were mechanism errors #5–6 of the day, extending the evening's count of four. Payload size is not a proxy for latency: the bridge/transport overhead dominates and is invisible to size-based reasoning. Rule: wall-clock per external call is measured with a clock, never inferred from how much data crosses the wire.

### A signal nobody can see isn't a signal
Failure counters must land somewhere observable — a DB row, a status surface — not stdout that never reaches a terminal. The `mail_meta` precedent: a counter written to stdout under a GUI-launched process (no attached terminal) accumulated real failures that no one ever saw. If you instrument a failure path, the instrument's output has to land where a human or a query will actually read it; otherwise the instrumentation is decorative. Pairs with the §10 stdout-pollution gotcha — stdout is the wrong sink for signal as well as for protocol.

### The stale-runtime confound
A probe is only valid against a process launched *after* the build it is meant to test. Probing a still-running old process after a rebuild tests stale bits and reports a false result — false-green or false-red, both worthless. This is the runtime cousin of "smoke the bits you ship" (this day's evening sibling): a green build is not enough; relaunch the process from the new build before you trust the probe, and confirm the launch post-dates the build.

### The honest hold
When live verification is environmentally blocked, ship the PR with the gap stated plainly in the §7 body and HOLD the merge until the path is observed green — the #154 precedent. Two hard rules attach: never manufacture a pass, and never write synthetic data into a real user store to fake one. A held PR carrying an honest gap is correct and cheap; a merged PR carrying a fabricated green is a lie that surfaces later at higher cost. The hold is the discipline, not a failure of it.

### Environmental degradation is a finding
Mail.app's AppleScript latency is not friction to route around silently — it is a documented finding. The slowness is recorded, and the Envelope-Index alternative (reading Mail's index directly rather than via AppleScript) is banked in an ADR with an explicit 48h trigger: if the latency persists past that window, switch. Naming the degradation and pre-committing the escape hatch — with a tripwire, not a vibe — turns an annoyance into an actionable decision the next session can execute without re-litigating.

### §13.10 shape 6 graduation — parked
The evening section's "hand-edit hotfix shape" is a candidate for formal promotion to a CLAUDE.md §13.10 *shape 6*. This is a docs-only lane scoped to `governance-log.md` + `CHANGELOG.md` (per §10, new governance batches append here, not into CLAUDE.md), so the graduation is **not** taken in this PR — it remains parked for a lane that legitimately touches CLAUDE.md. Recorded here so the next CLAUDE.md-touching lane picks it up without rediscovering the candidacy.

---

## 2026-06-04 — self-building day lessons

The self-building day — RAVEN's first rung at drafting its own work (rung 1,
proposals become paste-ready lane prompts, #168) plus a voice-driven calendar
agenda and panel (#170) — banked six lessons. Two complete running threads
from the prior days: the night's "stale-runtime confound" grows into a full
family, and "measure, don't reason" extends to calibrating a smoke's external
oracle. The rest are new — expectations and guardrails for machine-drafted
specs, and the gap between a declared tool and a called one.

### The stale family, complete
The night section banked one staleness failure (a probe run against a process that predates its build). The self-building day completed the family: three distinct stale-state failures, each at a different layer the change rides.

1. **Stale runtime** — the process predates the build (the night's confound). Relaunch from the new build before trusting any probe.
2. **Stale detached daemon** — an orphan daemon from a prior session keeps serving the OLD config. Raven's `_discover_tool_modules` runs once, at spawn only, so a daemon that outlived its rebuild never re-discovers the new tool and silently serves the old tool set (#168). Killing-and-relaunching the runtime you *think* you control doesn't help if a detached orphan is the one actually answering.
3. **Stale dist** — `install ≠ build`. TS nodes run from compiled `dist/`; python nodes run from source. So `pnpm install` alone leaves TS behavior frozen at the last build while python is already fresh — a split-brain where half the stack is new and half is old.

Lesson: "fresh" is not a single fact — it must be proven at every layer the change actually rides (runtime process, detached daemons, compiled artifacts). A change that touches a python tool AND a TS node clears three different staleness gates; clearing one and assuming the rest is the trap.

### Calibrate the oracle before trusting the failure
A smoke compares observed behavior against an external ground truth — the oracle. #170's calendar-agenda smoke read Calendar.app and reported a wrong time: a false negative. The fault was the oracle, not the code — Calendar.app's own timezone configuration (the instrument) was off, so the test rig was lying. The code was right; a revert made on the false signal was itself reverted once the instrument was calibrated. Director-side catch. Lesson: the external ground truth a smoke leans on is PART of the test rig, not a neutral fact of the universe. Verify the instrument — the oracle's own config (timezone, locale, clock, account state) — before trusting a failure. A miscalibrated oracle produces false negatives indistinguishable from code bugs and costs a wasted revert. Pairs with the night's "measure, don't reason": there the instrument was a clock; here it is Calendar.app.

### Recount, don't inherit — parallel editors of one fact
When two branches both edit the same scalar — here raven's tool count, which #168 bumped (adding `draft_lane` as tool 19) alongside a parallel calendar lane — neither branch's value is correct at merge. Each counted from its own starting point, blind to the other's addition, so adopting either number inherits an undercount. The fix: RE-DERIVE the fact from ground truth at merge time (recount the actually-registered tools), never trust the number written in either branch. Lesson: a fact edited by parallel editors is not mergeable by taking a side — it must be recomputed from source at the merge point. Tool counts, port allocations, enum maxima, "N nodes" claims — any scalar two lanes can independently increment — gets recounted, not inherited. (§11 heuristic 6, reserve-space, is the prevention side; this is the merge-time cure.)

### The recon-first guardrail makes thin specs self-limiting
Rung 1 (#168) has RAVEN compose lane prompts from accepted proposals. A machine-drafted spec is necessarily thinner than an Architect's, and a thin spec freelanced by an eager Implementer is dangerous. The mitigation that made rung 1 safe: a FIXED template line — the recon-first guardrail — baked into every drafted prompt, instructing the Implementer to read the named precedents and STOP to report options whenever a design decision isn't covered by the spec. The constant line turns the spec's thinness into a feature: faced with an uncovered decision, the Implementer recons and halts instead of inventing an answer. The spec self-limits. Lesson: when a spec is generated by a weaker author (a model, a template, a junior), don't try to make it complete — make it honest about its own gaps. A constant "recon, and stop at anything I didn't cover" guardrail is cheaper and safer than attempting exhaustive coverage, and it scales the right way: the thinner the draft, the more often the guardrail fires.

### Rung-1 expectations, set
What live-session drafting (a model composing specs inside the working loop) can and can't do is now calibrated. A live-session draft is a FIREABLE START for a simple lane and a GUARDED SKELETON for a hard one — never a finished deep spec. Draft depth is model-bounded: a stronger model drafts deeper, but the ceiling moves with the model, not with prompt effort. Deep specs remain Architect work. The next rung — 1.5, offline-model composition (a separate model drafting specs out-of-band rather than in the live session) — is banked as the path to deeper machine-drafted specs without burning the live session's context. Lesson: machine self-building is real but graded — usable today for simple lanes, skeleton-only for hard ones, bounded by the drafting model's depth. Don't expect a live-session draft to replace a deep Architect spec; expect it to bootstrap one.

### Routing is runtime behavior — a declared tool isn't a called tool
A tool can be fully declared — registered with Gemini, edge-permitted, present in `get_tools()` — and still never get CALLED, because routing (which utterances reach which tool) is decided by the live session's instruction-following, not by the harness. #168's `draft_lane` surfaced this: asked to draft, RAVEN could deflect with "that will be added as well" — acknowledging the capability rather than invoking it — exactly the failure the HARD ROUTING RULE in `prompts.json` (accept-verbs must call `draft_lane` on the same turn, never defer, never route an accept to `report_gap` as a missing capability) was written to prevent. The declaration is necessary but not sufficient; the routing is earned in the live session. Lesson: declaring a tool wires the CAPABILITY; instruction strength wires the BEHAVIOR. A tool's presence in the manifest / `get_tools()` proves it *can* be called, not that it *will* be — verify routing by speaking the trigger and watching the tool fire, never by confirming the declaration exists. Pairs with the §10 "GitHub Actions silently accept unknown inputs" gotcha (declaration ≠ effect) and the evening's "smoke the bits you ship."

## 2026-06-07 — spawn v1.1 lessons

### macOS system Python can't load sqlite extensions — pin the interpreter, never trust spawned PATH
The spawn v1.1 RAG bootstrap recorded `rag: failed@reindex` on a fresh worktree. Root cause: a spawned process gets a sparse PATH, so a bare `python3 -m venv` resolved to Apple's **system** Python, whose `sqlite3` is built WITHOUT `enable_load_extension`. `sqlite-vec` (the vector index aether-rag needs) is a loadable extension → it can't load → `reindex.sh` dies. Verified on this machine by `readlink -f`: main's working venv resolves to `/opt/anaconda3/bin/python3.12` (capability test passes); the spawned venv's python returns `False` for the same test. The two key facts: **(1)** a venv INHERITS its creator interpreter's sqlite build — picking the wrong python at `venv` time poisons everything downstream, silently, until an extension load fails three steps later; **(2)** "which python3" is not a fact you can assume in a spawned/GUI-launched/sparse-PATH environment — it must be DETERMINED, not trusted. Fix: before `python -m venv`, probe candidate interpreters in priority order — (a) the interpreter behind the repo's own working `aether-rag/.venv/bin/python`, fully symlink-resolved (ground truth this machine has a capable sqlite3); (b) Homebrew's python3; (c) bare PATH python3 — each tested with `python -c 'import sqlite3; sqlite3.connect(":memory:").enable_load_extension(True)'`; first exit-0 wins and creates the venv. None pass → a named best-effort failure, the spawn still launches. Lesson: when a downstream step needs a specific build-time capability of an interpreter (sqlite extensions, SSL, a compiled module), PIN the interpreter by capability-probing it up front; never let a spawned environment's PATH choose it for you. The §13.12 manual recipe and the spawn actor now share the same pinned-interpreter rag step so hand-made worktrees match spawned ones.

### kill -0 proves liveness, not identity — pids recycle
The boot-time orphan-daemon reap originally SIGTERM'd any pid in `daemon.pid` that `kill(pid, 0)` reported alive. But a pid is a recycled handle — by the next boot it may belong to an unrelated process, and signalling it is collateral damage. The reap now matches the pid's command line (`ps -o command= -p <pid>`) against the daemon dir before signalling; no match → treat as not-ours and only clear the stale pid file. Lesson: liveness and identity are different questions. `kill -0` answers "is something there"; before sending a real signal you must also answer "is it the thing I think it is" — for a recyclable handle (pid, fd, port-holder) the identity check is mandatory, not optional.

## 2026-06-11 — organ-building arc field gotchas

Four §10-class gotchas from the organ-building arc (#314–#321), banked before
they fade: a silent self-skip in the reviewer cell's own action, two more
build-time defects in the macOS interpreter family the 2026-06-07 batch opened,
and a black screen from pulling a merge under a running dev server.

### claude-code-action skips itself silently when the calling workflow differs from main
Symptom: a green Actions run with NO verdict comment — not APPROVE, not CONCERNS, not an error; the only trace is a warning annotation buried in the run log (`Skipping action due to workflow validation: Workflow validation failed. The workflow file must exist and have identical content...`). Cause: anti-tamper in `claude-code-action` — when the *calling workflow file's* content on the PR branch differs from `main` (edited, or newly created so main has no copy), the action declines to execute and the step exits 0 having done nothing. Field: #314, the PR that introduced the reviewer cell — both spec-review runs on it completed green but skipped themselves, because the workflow file under test was the file the PR was adding. This is the silent sibling of the §10 "Claude GitHub App refuses to validate workflow changes against themselves" entry (same defense, but here nothing visibly refuses) and a second instance of the §10 "GitHub Actions silently accept unknown inputs" law that exit code is necessary but not sufficient. Rule: a green run of a claude-code-action workflow proves nothing until the expected behavior (the posted verdict) is observed; a PR that edits or creates the calling workflow gets no verdict on its own branch — merge first, validate on the next PR; and on any green-run-no-verdict sighting, diff the calling workflow against main before debugging anything else.

### python.org macOS builds can't load sqlite extensions either — the bad-interpreter family grows
Symptom: an aether-rag venv that installs cleanly but dies at query time — `sqlite-vec`, a loadable extension, can't load. Cause: python.org's official macOS installers, like Apple's system Python, build `sqlite3` WITHOUT `enable_load_extension` (#319). The 2026-06-07 batch pinned this failure to the system Python a sparse spawned PATH resolves to; #319 establishes the family is bigger — provenance ("a real Python, installed from python.org") does not clear an interpreter, and the failure stays invisible past venv creation and `pip install`, surfacing only at first query. Known-good builds on this machine: Homebrew and Anaconda. Rule: RAG venvs are created from a Homebrew or Anaconda python, and the 2026-06-07 capability probe (`python -c 'import sqlite3; sqlite3.connect(":memory:").enable_load_extension(True)'`) remains the gate — probe the build, never infer it from where the interpreter came from.

### python.org macOS builds ship no wired system CAs — use certifi when available
Symptom: HTTPS calls under a python.org interpreter die with `SSL: CERTIFICATE_VERIFY_FAILED` against hosts every browser on the machine trusts. Cause: python.org macOS builds bundle their own OpenSSL and do NOT wire it to the macOS system trust store — trust is supposed to arrive via the post-install `Install Certificates.command` double-click, which never happens in scripted setups; Homebrew/Anaconda builds don't share the defect. Field: #319 — `_gh_request` in the architect-draft composer uses certifi's bundle when available (certifi rides the venv transitively) with a stdlib fallback. Rule: code that may run under a python.org build passes `certifi.where()` as the CA bundle when certifi is importable, falling back to the stdlib default otherwise — the sqlite lesson wearing TLS clothes: a build-time capability of the interpreter (extension loading, wired CAs) is probed or provisioned, never assumed.

### Pulling a merge into a running dev server's checkout hot-swaps code under a live renderer
Symptom: the running Electron app goes black-screen the moment a merge lands in the checkout it was launched from (field, 2026-06-11 — no PR; hit pulling an organ-building-arc merge into the primary checkout while the dev server was up). Cause: the dev server runs from the working tree, so `git pull` rewrites main-process and preload code on disk under the live app — the renderer ends up paired with main-process code it never booted against, a split-brain hot-swap rather than a clean reload. Rule: quit the app first — or run it from a dedicated worktree so merges land elsewhere — before pulling into its checkout (now one line in CLAUDE.md §13.12). Kin to the stale family (2026-06-04): there the process predates the build; here the tree mutates under the process. Same law from the other side — a process and the tree it runs from must move together.
