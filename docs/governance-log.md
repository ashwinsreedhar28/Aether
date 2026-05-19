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

### Subagent rationale

The read-phase problem is structural: Implementer's main context fills with raw file content during reads, then the same context has to hold the write plan. On hostile-API days the read phase stalls before the write begins. The subagent split fixes it:

- `aether-explorer` (Haiku) reads in isolated context, returns a summary, never writes.
- `aether-implementer` (Opus) is the canonical builder; first action is a write.
- `aether-reviewer` (Sonnet) runs the §11 walk-through before the PR opens.

### Skills rationale

The repetitive verify+commit+PR dance was being rewritten in every prompt. Extracting `verify-build` and `ship-it` makes the sequence canonical and resolves the stall pattern via explicit two-phase commit with a Director gate.

### GitHub Issues / PR template rationale

Sprint 4 backlog lived in chat history and `_session_state.md` — neither visible to a returning Director or future Implementer session without onboarding. Issues make backlog repo-public. PRs with `Closes #N` close the loop automatically and produce navigable history.
