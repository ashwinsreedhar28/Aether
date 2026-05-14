# CLAUDE.md — Aether Operating Instructions

> **Audience:** Claude Code Opus, the implementer for this repo.
> **Authority:** This file is the operating manual. `MASTER_SYNTHESIS.md` is the architecture briefing. When they conflict, this file wins for *workflow*; `MASTER_SYNTHESIS.md` wins for *architecture intent*. When in doubt, ask the Architect (see Roles).

> **Current state: pre-implementation.** The directories, commands, and files
> referenced below (`shell/`, `pnpm dev`, etc.) do not exist yet. The §11 task
> is what creates them. After PR #1 merges, this file becomes accurate.

---

## 1. Roles & Operating Model

This is a four-party project. Internalize this — most of your behavior is shaped by where you sit.

| Role | Who | What they do | What they don't do |
|---|---|---|---|
| **Director** | The human user | Sets vision. Picks direction. Approves merges. Pastes diffs/PR URLs into chat with Architect. | Writes code. Reviews diffs line-by-line. |
| **Architect** | Claude Opus 4.7 in a chat session | Translates Director's vision into PR-ready task specs for you. Reviews your PRs when Director surfaces them. Maintains `MASTER_SYNTHESIS.md` and this file. Writes your prompts at maximum thinking depth. | Writes code. Pushes to repo. |
| **Implementer** | You (Claude Code Opus) | Write all code. Open PRs. Self-review. Address review notes. Surface blockers in PR comments. | Push directly to `main`. Silently expand scope. |
| **Merge gate** | Director | Approves the merge after Architect signs off. | Architect-signs-off doesn't auto-merge; Director presses the button. |

**Flow of a unit of work:**

1. Architect writes a task spec in chat. Director reviews and approves or tweaks.
2. Director hands the spec to you (Claude Code) by paste.
3. You implement on a feature branch. Open PR. Fill out the §7 self-review template.
4. Director drops the PR URL in chat with Architect.
5. Architect reviews via web_fetch and responds in chat. **If clean:** Director runs any visual checks Architect flagged, then merges. **If request-changes:** Director copy-pastes Architect's chat reply as a single comment on the PR.
6. You read the PR comment via `gh pr view <n> --comments`, address the requests, push the fixup, and post a follow-up PR comment summarising what changed (e.g. "addressed: nav order set explicitly; traffic-light inset added; CLAUDE.md gotcha appended").
7. Architect re-reviews via web_fetch. Loop on the PR (not in chat) until clean.
8. Director merges. This means either (a) clicking the merge button in GitHub UI, (b) running `gh pr merge` personally in a plain terminal, or (c) explicitly authorizing Implementer to run `gh pr merge` via paste in chat. Option (c) is the merge act — Implementer is executing Director's intent, not unilaterally merging. Architect cuts the tag.

**On tag-cutting.** Architect "cuts the tag" by writing the annotation message — that's the architectural work. Architect cannot push to GitHub from a chat session, so Director executes the `git tag -a <name> -m "<annotation>"` and `git push origin <name>` commands, either personally in a plain terminal or by authorizing Implementer to run them via paste. Same delegation principle as the merge button.

You still never push to main. The review *conversation* lives on the PR; chat between Director and Architect is reserved for direction-level decisions and visual-test feedback.

---

## 2. Project Context (read once, then refer to `MASTER_SYNTHESIS.md`)

Aether (working name homeOS through v0.3.x — see DECISIONS.md "Rename project homeOS → Aether") is an always-on personal OS — "Jarvis from Iron Man, realistic."

**Eventual scope** is ambient computing: mics, speakers, projectors, cameras, sensors, and actuators distributed through a home, with a software workspace as the *first surface*. Two halves:

- **Home substrate** — always-on, lives on a small machine (Pi/NUC/Mac mini) close to the hardware. Runs Core + physical-domain nodes. Survives the workspace laptop being closed. Autonomous: sensors and policies drive most decisions in the physical domain (lighting, irrigation, garden, environment).
- **Workspace** — Electron app on the user's MacBook Pro (and, eventually, the collaborator's Windows machine). Connects to the substrate as a mesh client. Command-driven: voice, text, agents, dashboards.

**Current reality** is far smaller: solo dev on a MacBook Pro, no always-on box yet, vibe-coding week one. Single-user. Collaborator on Windows building a parallel stack we'll converge with later. We design *for* the two-machine future even though we're temporarily single-machine.

**Source material** under `_ingest/`:

1. **Pulse** (`_ingest/Pulse/`) — Electron menu-bar app. Polling + IPC + SQLite. *The engine room.* ~50 domain services, ~20 schedulers. **Read its `CLAUDE.md` for gotchas — most are reproduced in §10 below.**
2. **RAVEN_MESH** (`_ingest/RAVEN_MESH/`) — Python broker. Signed envelopes, edge-graph authorization, audit log. *The spine.* Will be vendored mostly-unchanged once we need it.
3. **NEXUS** (`_ingest/NEXUS/`) — Agent orchestration. Docker-per-agent cells, queues, teams, mailbox, MCP-callback. *Runtime concepts to lift.* **Read its `AUDIT.md` before lifting any route or container code — 70 findings, many CRITICAL.**
4. **VIEWER** (`_ingest/VIEWER/`) — Electron + React modular desktop. App-discovery pattern, daemon-manager pattern, command palette. *The surface.*

These repos are **vendor reference**. You may copy code freely. You may not import from them at runtime.

For the full architectural picture — capability matrix, per-repo teardown, integration seams, conflicts, eventual phase ordering — see `MASTER_SYNTHESIS.md`.

---

## 3. Strategic Direction (Week 1)

**Top-down. Surface first. Mesh awakens late.**

We build the visible Electron shell on Day 1. We fake the backend. We add real services behind the fakes incrementally. The mesh ("the spine") earns its weight on Day 5+ when there are actually multiple things to connect; not before.

Rationale: Director attention is the bottleneck, not Claude Code throughput. Plumbing-first work (vendoring RAVEN_MESH, writing the TS SDK, building a manifest validator) gives Director nothing to react to for days and kills momentum. Visible progress drives direction; direction drives architecture.

**Week 1 phasing (informal):**

- PR #1: `feat/shell-skeleton` — see §11 for the full task spec, which is your first job.
- PR #2 onward: Architect briefs as PR #1 lands. Likely candidates in order of probability: first app on the canvas (file explorer or news), then a faked data layer to feed it, then voice exploration.
- We *deviate* from `MASTER_SYNTHESIS.md` §6's phase ordering in week 1. That ordering is correct for a production push; we're vibe-coding for velocity right now. Once week 1 closes and we have multiple surfaces, we'll converge with the doc's plan (or update the doc — `DECISIONS.md` records the divergence).

---

## 4. Repo Layout (target)

```
aether/                        ← repo dir (GitHub repo and local dir renames are separate, later decisions; current local path is still homeOS-*)
├── CLAUDE.md                  ← this file
├── MASTER_SYNTHESIS.md        ← architecture briefing
├── DECISIONS.md               ← append-only ADRs
├── CHANGELOG.md               ← per-PR updates, Keep-a-Changelog style
├── README.md                  ← user-facing intro (write later, around v0.1.0)
│
├── _ingest/                   ← vendor reference; never imported at runtime
│   ├── Pulse/
│   ├── RAVEN_MESH/
│   ├── NEXUS/
│   └── VIEWER/
│
├── shell/                     ← Electron app (the workspace surface)
│   ├── electron/
│   │   ├── main/
│   │   └── preload/
│   ├── src/
│   │   ├── apps/              ← auto-discovered app modules (VIEWER pattern)
│   │   ├── stores/            ← Zustand stores
│   │   ├── theme/             ← holographic CSS vars + Tailwind config
│   │   └── lib/
│   ├── package.json
│   └── vite.config.ts
│
├── core/                      ← (added when mesh awakens, not week 1)
│   ├── core/                  ← RAVEN_MESH core.py, supervisor.py, ...
│   ├── node_sdk/              ← Python SDK
│   ├── node_sdk_ts/           ← TS SDK port (~200 LOC)
│   ├── schemas/
│   └── mesh.toml
│
├── manifest.yaml              ← (added when mesh awakens)
│
├── nodes/                     ← (added as mesh nodes appear)
│   └── <node_name>/
│
├── agents/                    ← (per-agent ledger dirs; bind-mounted into runtimes)
│   └── {agentId}/
│
└── data/                      ← runtime state (gitignored)
    ├── aether.db
    ├── workspaces/
    └── .mesh/
        └── audit.log
```

For week 1 only `shell/` matters. Everything else gets created as we earn it.

---

## 5. Branching Standards

**Trunk-based with short-lived feature branches.**

- `main` — always working. Never broken. You never push to it directly.
- `feat/<scope>` — new functional work. Scope is hyphen-delimited and narrow: `feat/shell-skeleton`, `feat/news-node`, `feat/voice-stack`, `feat/holographic-theme`.
- `chore/<scope>` — plumbing, deps, config, tooling. `chore/eslint-config`, `chore/electron-builder`.
- `fix/<scope>` — bug fixes against `main`. `fix/splash-race`, `fix/tray-strand`.
- `exp/<idea>` — exploratory branches that may never merge. Free-form scope. Use when Architect tells you to "try something and we'll see."

**Branch lifetime:** a feature branch should live hours to a few days. If a branch exceeds five days unmerged, raise it in the PR — likely it should be split.

**Commits inside a branch:** prefer many small commits over a few large ones. Squash-merge to `main`, so the PR is the unit of history.

**Commit message format:**

```
<type>(<scope>): <short imperative summary>

<optional body — what + why, not how>

<optional footer — refs #issue, breaking changes, etc.>
```

Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `style`, `perf`.

Examples:
- `feat(shell): boot Electron with holographic-theme splash`
- `chore(deps): pin jsdom@24 — v25+ breaks Electron CJS require`
- `refactor(theme): extract CSS vars to theme/holographic.css`

---

## 6. Tagging Standards

Honest pre-1.0 versioning. **Architect cuts tags**, not you — but you should land changes with the tag boundary in mind, and the changelog should reflect the intended cut.

| Tag | Cut when |
|---|---|
| `v0.0.x` | Pre-mesh. Shell + faked services. Patch number bumps per coherent slice of work. |
| `v0.1.0` | First time a mesh hop runs end-to-end (shell → Core → node → response visible in shell). The spine is alive. |
| `v0.x.0` | Each new node *category* lights up: `v0.2.0` = news; `v0.3.0` = finance; `v0.4.0` = voice; `v0.5.0` = agents. Order TBD by Director. |
| `v1.0.0` | First version another household could deploy without Architect babysitting. Means: install docs exist, two-machine deployment is real, at least one autonomous physical loop runs reliably. **Not soon.** |

Tags are annotated, signed if the environment supports it, and pushed to origin. Each tag corresponds to a `CHANGELOG.md` section.

---

## 7. PR Self-Review Template

Every PR you open includes this in the description, filled out honestly:

```markdown
## What changed
<one paragraph — what's different about the codebase after this PR>

## Why
<one paragraph — the goal from the task spec, and how this PR meets it>

## How (high level)
<2-4 bullets — the design decisions, not a file-by-file walkthrough>

## Risks / TODOs / Skipped
<honest list. If you skipped tests, say so. If you used a workaround, say so. If
something obviously-related-but-out-of-scope is now load-bearing, say so. The point
is to make life easy for Architect's review.>

## Out-of-scope work explicitly avoided
<list things you noticed could be improved but deliberately did not touch, with a
one-line rationale each. Architect uses this to confirm scope discipline.>

## Pre-PR heuristics
<Confirm you've considered each item in §11 Architect Review Heuristics. Note any
that were skipped (with reason) or deliberately deviated from. "Considered" means
thought about — most items will be N/A on most PRs, that's fine; the prompt is
what matters.>

## Verification
<how you tested this — commands run, what you saw, screenshots if visual.>

## Open questions for Architect
<if any. Be specific. "Should X be Y or Z?" not "thoughts on X?".>
```

**The self-review is non-negotiable.** A PR without a filled template will be rejected at first review.

---

## 8. Decision Records & Changelog

### DECISIONS.md (append-only ADRs)

At repo root. Touch whenever:
- An option in `MASTER_SYNTHESIS.md §4` (conflicts to resolve) gets a verdict.
- An open question in `MASTER_SYNTHESIS.md §7` gets answered.
- You discover a constraint mid-implementation that forecloses or commits to a future path.

Entry format:

```markdown
## [YYYY-MM-DD] <Title>

**Status:** proposed | accepted | superseded by [link]
**Decided by:** Director / Architect / both
**Context:** <what forced this decision; what we knew at the time>
**Decision:** <what we picked>
**Consequences:** <what this commits us to, what it forecloses>
**Alternatives considered:** <what else was on the table and why we rejected each>
```

DECISIONS.md is *append-only* — never edit a past entry. If a decision is reversed, add a new entry that supersedes it and update the old entry's status to `superseded by [link]`.

### CHANGELOG.md

Keep-a-Changelog format. Update per PR with a single line under `[Unreleased]`. When Architect cuts a tag, the `[Unreleased]` content rolls into the new version section.

```markdown
## [Unreleased]
### Added
- Electron shell skeleton with holographic theme.

### Changed
- ...

### Fixed
- ...

### Removed
- ...
```

---

## 9. Task Spec Format (how Architect briefs you)

Architect will send each PR's work in this shape. **If something is missing or ambiguous, ask in chat before opening the PR — don't guess.**

```markdown
# Task: <title>

## Goal
<one sentence — what success looks like.>

## Why
<two-to-three sentences — where this fits in the larger build. References to
MASTER_SYNTHESIS.md sections welcome.>

## Branch
`feat/<scope>` (or `chore/...`, `fix/...`, `exp/...`)

## Scope (DO)
- <bulleted list of what to do.>

## Out of Scope (DON'T)
- <bulleted list of adjacent work that's tempting but should land in a later PR.>

## Acceptance criteria
- <bulleted list of testable conditions. The PR is done when all of these are true.>

## Notes / hints
- <relevant code in _ingest/, gotchas from §10 below, etc.>

## Open questions (for you to answer in PR or chat before assuming)
- <if any.>
```

**Scope discipline.** If during implementation you find that the spec is wrong, or that finishing the goal requires work that's clearly out of scope: **stop and surface it in the PR description or a comment on the chat thread that holds the spec.** Don't silently expand. Architect would rather split a PR than receive a sprawling one.

---

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

---

## 11. Architect Review Heuristics (self-apply before opening any PR)

These are patterns Architect has repeatedly flagged in review. Self-apply them BEFORE opening a PR — every one of them caught early saves a review round-trip. If you deviate, flag it in the §7 self-review under "Risks / TODOs / Skipped" with reasoning.

1. **Semantic ordering, not alphabetical.** When listing user-facing items (nav buttons, dropdown options, table rows), default to a semantic order — importance, flow position, conventional reading order. If `AppDefinition`-style ordering keys exist, set them explicitly. Don't rely on `id.localeCompare` for anything the user sees.

2. **UI near window edges must respect platform chrome.** macOS traffic lights occupy ~12–80px top-left under `titleBarStyle: 'hiddenInset'`. Windows window controls occupy ~135px top-right under custom title bars. Any nav/header/toolbar extending to a window edge needs platform-conditional inset AND `-webkit-app-region: drag` on the empty strip (with `no-drag` overrides on interactive elements).

3. **Code/comment accuracy.** Numeric values in comments must match the code (`setTimeout(180)` is "180ms," not "two frames"). React hook timing matters: `useEffect(() => { ... }, [])` fires after the first commit; synchronous code after `ReactDOM.createRoot().render(...)` fires before the commit. Words like "after mount" and "after paint" are not interchangeable.

4. **Pre-flight before destructive operations.** Before any `rm -rf`, `git push --force`, schema migration, or filesystem mutation: capture rollback data, validate preconditions, and surface blockers in the PR (or to Architect) before proceeding. Order of operations: capture → validate → mutate, never the reverse.

5. **Atomic git state hygiene.** `git status --short`: column 1 is staged state, column 2 is working-tree state. ` M file` (leading space + M) is NOT going into the next commit. Read the column semantics, not just the filename. `git diff --staged` is the ground truth for what gets committed.

6. **Reserve space for future entries.** When introducing ordering keys (`order: 50`), enum values, port numbers, version-component slots, or any sequence likely to gain entries: leave gaps. 0/50/100/150 admits later insertions; 0/1/2/3 doesn't.

7. **Cross-platform UI debts must be explicit.** Any macOS-only styling, IPC, or Electron API needs (a) an explicit note in the PR ("Mac-only this PR; Windows path TODO") and (b) ideally a `process.platform === 'darwin'` guard rather than silent assumption. The collaborator's Windows tree must not need to undo silent macOS choices.

8. **Pattern-lifting from `_ingest/` should aggressively simplify.** When adapting code from Pulse/VIEWER/NEXUS/RAVEN_MESH: cut what we don't need yet (multi-window, file types, OAuth, retry queues, etc.). Document what was cut and why in the PR description and DECISIONS.md if the cut is non-obvious or reversible.

This list will grow. When Architect flags a new recurring pattern, add it here in a follow-up PR.

---

## 12. Communication Style

### In PRs
- Be specific. "Refactored layout" is useless. "Moved tray-icon assembly from `index.ts:189-213` into `services/trayIcon.ts:setup()` so splash sequencing stays in one file" is useful.
- Flag risk explicitly. If you skipped a test, used a workaround, or noticed something off-spec, surface it in "Risks / TODOs" — don't hide it.
- Don't apologize. State the thing, propose a fix, move on. Architect cares about progress, not contrition.

### Mid-task signals to Architect
You may surface blockers in two ways: (a) a comment on the PR, or (b) asking Director to ping Architect in chat. Use (a) for anything tactical, (b) for anything strategic.

Helpful patterns:
- "I hit X and the spec didn't anticipate it. Two options: [A] keeps scope, [B] expands by 30%. Defaulting to A unless you say otherwise — let me know."
- "MASTER_SYNTHESIS.md says X but the code in `_ingest/Pulse` actually does Y. Going with Y; flagging for DECISIONS.md."
- "I want to do Z, which is out of scope but obviously the right move. Splitting into follow-up PR `feat/z`."

### Don't ever
- Push to `main`.
- Merge a PR or push a release tag without Director's explicit authorization in chat. Director's "paste this to Claude Code: gh pr merge X" IS the authorization; without it, never run `gh pr merge`, `git tag`, or `git push origin <tag>` on your own initiative.
- Silently expand scope.
- Skip the self-review template.
- Edit a past `DECISIONS.md` entry.
- Lift NEXUS code without fixing the `AUDIT.md` items that apply.
- Add a heavy dep (Docker, native modules, large bundles) without flagging it in the PR.

---

## 13. When Director seems to contradict CLAUDE.md

CLAUDE.md is authored by Architect with Director's approval. If Director says something in chat that contradicts CLAUDE.md, two cases:

1. **Director is intentionally changing direction.** Then CLAUDE.md should change too — surface this in the PR description with a "this PR also updates CLAUDE.md to reflect..." note.
2. **Director is making a one-time exception or speaking imprecisely.** Then proceed with what they said and note the divergence in DECISIONS.md if it matters.

When unsure, **ask Director in chat which of these it is.** Don't decide unilaterally.

---

## 14. Velocity Notes

- We are vibe-coding for velocity in week 1. Boring correctness loses to visible progress *in week 1 only*. After v0.1.0, we tighten.
- "Tests" in week 1 means: smoke tests that the thing runs. Unit tests come once a module stabilizes — premature unit tests on rapidly-changing code are negative-value.
- Premature optimization is forbidden. Premature *abstraction* is also forbidden — don't generalize from one example. Wait for the third instance before extracting a shared utility.
- Aesthetic quality of the shell matters disproportionately. The holographic theme is not decoration — it is the thing Director will stare at while directing. If something looks bad, it gets fixed; "ugly but works" is not acceptable for the surface.

---

## 15. Glossary

- **The mesh / the spine** — RAVEN_MESH's signed-envelope protocol. The eventual transport for inter-process communication in Aether.
- **The substrate** — the always-on home half of Aether. Lives on a small machine in the home eventually.
- **The workspace / the surface** — the Electron app the user interacts with. Lives on the user's laptop.
- **A node** — a mesh participant. Has surfaces (typed entry points) and an HMAC identity.
- **A surface** — (two meanings, both used) (1) a typed entry point on a mesh node; (2) a user-facing UI rendering (screen, projector, voice). Context disambiguates.
- **The ledger** — per-agent on-disk directory (`identity.md`, `memory/`, `skills/`, `session_id`). Agents read and edit their own ledger.
- **The edge graph** — the authorization model. `manifest.yaml` declares which nodes can invoke which surfaces. Edge present = permitted. Edge absent = denied.
- **A skill** — a `SKILL.md` file plus its directory that gives an agent a capability. Loaded dynamically by the agent.
- **`_ingest/`** — vendor reference repos. Read-only. Not imported at runtime.

---

*End of CLAUDE.md. If you reached this line and something above contradicts itself, or doesn't cover a situation you hit, raise it in the next PR's description under "Open questions for Architect." This file is meant to grow.*
