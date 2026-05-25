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

1. **Pulse** (`_ingest/Pulse/`) — Electron menu-bar app. Polling + IPC + SQLite. *The engine room.* ~50 domain services, ~20 schedulers. **Read its `CLAUDE.md` for gotchas — most are reproduced in `docs/governance-log.md`.**
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

Entry format. All six fields below are **required** and appear in this order — `Status`, `Decided by`, `Context`, `Decision`, `Consequences`, `Alternatives considered`. An ADR missing any of these gets rejected at review and amended in the same PR. The fields are the binding shape of an Aether ADR; the rest of an entry (prose, sub-bullets, links) is freeform.

```markdown
## [YYYY-MM-DD] <Title>

**Status:** proposed | accepted | superseded by [link]
**Decided by:** Director / Architect / both
**Context:** <what forced this decision; what we knew at the time>
**Decision:** <what we picked>
**Consequences:** <what this commits us to, what it forecloses>
**Alternatives considered:** <what else was on the table and why we rejected each>
```

DECISIONS.md is *append-only* — never edit a past entry. If a decision is reversed, add a new entry that supersedes it and update the old entry's status to `superseded by [link]`. Ordering: newest at top within a date; dates descending overall.

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
- <relevant code in _ingest/, gotchas from `docs/governance-log.md`, etc.>

## Open questions (for you to answer in PR or chat before assuming)
- <if any.>
```

**Scope discipline.** If during implementation you find that the spec is wrong, or that finishing the goal requires work that's clearly out of scope: **stop and surface it in the PR description or a comment on the chat thread that holds the spec.** Don't silently expand. Architect would rather split a PR than receive a sprawling one.

---

## 10. Hard Gotchas (lifted from `_ingest/` learning)

See `docs/governance-log.md` for the full governance log (Sprint 1 baseline plus accumulated batches). New batches append there, not here.

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

9. **Cross-doc consistency.** When a literal phrase, version number, package name, or terminology choice appears in more than one of CLAUDE.md / MASTER_SYNTHESIS.md / DECISIONS.md / CHANGELOG.md / README.md / docs/*.md, treat the set as one surface during a change. Pick the canonical form, then grep for the others — every divergence is either a doc-drift bug (fix in the same PR) or an intentional historical reference (DECISIONS.md and CHANGELOG.md entries dated before the divergence are policy-preserved verbatim; flag the divergence in the §7 self-review so the reviewer doesn't read drift as inconsistency). Common drift vectors: project name (homeOS vs Aether), version-current claims ("Current state (v0.x.0)" in README), tag tables, env var names, package scopes, port numbers, env-keyed paths. A passing typecheck does not catch a 0.3.0-in-README-while-CHANGELOG-says-0.5.0 mismatch — only a literal grep does.

10. **Pre-decide load-bearing decisions; leave non-load-bearing to Implementer.** Lane prompts should pre-commit decisions that affect downstream consumers, the substrate, or the wire contract. Leave non-load-bearing local choices (layout strategy, edge rendering style, animation approach, etc.) explicitly open with "pick whichever you can implement cleanly; document choice in PR body." This produces better decisions (Implementer has fuller context at write-time than Architect did at prompt-time) AND better documentation (the choice ships with reasoning attached in code comments + PR body). PR #113 chose radial Strategy A over Strategy B this way; reasoning landed in `RadialLayout.tsx` top comment AND PR body Open Questions section. If a future lane has zero non-load-bearing choices to delegate, the lane is probably over-specified.

11. **Hand-written documentation lanes don't need CC.** When PR content is direct compression of recent Architect-Director conversation (retros, ADRs, roadmap edits, governance updates), CC adds overhead with no value — the Implementer would have to reverse-engineer the same content from prior PR bodies and chat logs. Architect drafts in chat, Director pastes via heredoc, commits and ships. See §13.10 shape 3. PRs that landed via this pattern: #114 (roadmap doc), this retro PR. Do NOT use this pattern for code lanes; CC's structural review of changes (`grep`, file reads, typecheck) is real value.

This list will grow. When Architect flags a new recurring pattern, add it here in a follow-up PR.

---

## 12. Architectural Patterns

Named patterns that have earned their weight across at least one binding architectural decision. The point of naming them is so future PRs can say "applying the three-tier auth pattern" without re-deriving the rationale. Each entry below names the pattern, summarizes the shape, and cites the ADR(s) that bound it.

### 12.1 Three-tier auth: shell-UX / core-protocol / secret-store

For any third-party integration that requires user-bound authentication (OAuth, API keys, signed tokens), responsibility splits across three tiers that must not be collapsed:

- **Shell-UX tier (Electron shell).** Owns the user-facing auth experience — launching the system browser for OAuth consent, capturing the redirect on a loopback port, presenting account-connection state, prompting for re-auth on expiry. The shell is the only tier with a window and a clipboard; it is the only tier the user ever sees during an auth flow.
- **Core-protocol tier (raven-core or equivalent backend).** Owns the actual integration protocol — MCP client calls, REST/GraphQL invocations, token refresh logic, the typed adapter surface that the rest of the system consumes. The protocol tier reads tokens from the secret store and never asks the user anything directly.
- **Secret-store tier (OS-native keychain).** macOS Keychain under the bundle identifier (`com.aether.app`). The only tier permitted to persist authenticated material at rest. Tokens written by the shell-UX tier, read by the core-protocol tier; no other path persists them.

The boundaries are load-bearing because each tier's failure mode is different — UX failures need a user-visible affordance, protocol failures need retry/refresh logic, secret-store failures need OS-level error reporting — and conflating them produces auth flows that fail silently or leak credentials into logs. When designing a new authenticated surface, label which tier owns each piece of work in the task spec; if a single function spans two tiers, split it.

**Bound by:** DECISIONS.md "MCP integration arc roadmap" (2026-05-14) — first instantiation of this pattern across the MCP client substrate.

This section will grow. When an ADR introduces a pattern that is going to recur (rather than a one-off decision), name and add it here in the same PR.

---

## 13. Communication Style

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

## 14. When Director seems to contradict CLAUDE.md

CLAUDE.md is authored by Architect with Director's approval. If Director says something in chat that contradicts CLAUDE.md, two cases:

1. **Director is intentionally changing direction.** Then CLAUDE.md should change too — surface this in the PR description with a "this PR also updates CLAUDE.md to reflect..." note.
2. **Director is making a one-time exception or speaking imprecisely.** Then proceed with what they said and note the divergence in DECISIONS.md if it matters.

When unsure, **ask Director in chat which of these it is.** Don't decide unilaterally.

---

## 15. Velocity Notes

- We are vibe-coding for velocity in week 1. Boring correctness loses to visible progress *in week 1 only*. After v0.1.0, we tighten.
- "Tests" in week 1 means: smoke tests that the thing runs. Unit tests come once a module stabilizes — premature unit tests on rapidly-changing code are negative-value.
- Premature optimization is forbidden. Premature *abstraction* is also forbidden — don't generalize from one example. Wait for the third instance before extracting a shared utility.
- Aesthetic quality of the shell matters disproportionately. The holographic theme is not decoration — it is the thing Director will stare at while directing. If something looks bad, it gets fixed; "ugly but works" is not acceptable for the surface.

---

## 16. Glossary

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

## §13. Implementer Prompt Discipline

Every Implementer prompt is drafted by the Architect against the canonical template at `docs/implementer-prompt-template.md` and MUST include:

1. **Lane type tag** at the top: `LANE TYPE: TUNING | NEW-SURFACE | NEW-NODE | REFACTOR | CHORE | DOCS`. Orients the Implementer to the kind of work and reduces scope-drift risk.

2. **Pre-flight reads completed by Architect** — Architect's grep/file findings BEFORE drafting the prompt. Captures architectural facts (e.g. "feature X already exists at file Y, lane re-scoped"). Skipping this step has, twice in Sprint 4, produced wrong-scoped prompts that wasted Implementer sessions (#66 news-urgency, #67 splash). Mandatory.

3. **Large-file caution block** listing every file > 400 lines in scope, each with explicit `grep + view line_range` instructions. Full-reads of these files have been the single biggest cause of session retries during API-hostile periods. Known choke files (update when a new file breaches 400 lines):
   - `shell/electron/main/services/ravenDaemonManager.ts` (~720 lines)
   - `shell/electron/main/services/nodeRegistry.ts` (~510 lines)
   - `manifest.yaml` (~530 lines, grows ~25 per new node). Discovered as a
     choke during Sprint 4 Wave 2 when targeted-grep was the only viable read
     strategy on hostile-API days.
   - `docs/new-node-pattern.md` (~827 lines). Read in full once during the
     initial new-node-pattern lane; subsequent lanes treat it as reference
     via targeted grep.
   - `shell/electron/main/services/coreManager.ts` (~250 lines, grows ~10
     per node added via the env-secret pattern). Read once for pattern,
     then targeted str_replace only.
   - `.github/workflows/ci.yml` (~90 lines but high-value-density). Each
     new SDK-shape workspace package (consumed by other packages for
     types — e.g. `@aether/mesh-node-sdk`, `@aether/macos-applescript`)
     requires a one-line addition to the pre-build step. Grep before
     drafting any lane that adds a `core/*` workspace package.

   **Note:** `DECISIONS.md` and `CHANGELOG.md` were removed from this
   list in the archive lane (PR #80). Pre-2026-05-14 decisions moved to
   `docs/archive/decisions-pre-2026-05-14.md` and pre-Sprint-4
   `[Unreleased]` entries moved to
   `docs/archive/changelog-unreleased-pre-sprint-4.md`. Choke status
   returns if either top-of-tree file grows past ~800 lines again —
   currently `DECISIONS.md` is ~455 lines and `CHANGELOG.md` is
   ~125 lines.

4. **Pre-staged context** when ANY of the following is true: API symptoms in past 24h, lane requires 5+ file reads, or scope includes a known choke file. Architect dumps relevant file content inline so the Implementer's first action is a write, not a read.

5. **Lane scoping rules**: split a lane when total files touched > 8, cumulative changes > 500 lines, or scope spans multiple unrelated subsystems.

6. **Hard parallelism policy**: sequential Implementer sessions by default. Parallel sessions only after 24h of clean API readings.

7. **Stall protocol**: 3+ minutes of silent tool calls = interrupt and assess. 5/10 retries in the read phase = let the session bail. 10/10 retries = preserve-or-restart decision.

8. **Pulse/RAVEN hoisting language**: lanes that lift patterns from `_ingest/Pulse/` or `_ingest/RAVEN_MESH/` get explicit consult instructions naming the source files and the relevant pattern.

9. **Session-end checkpoint discipline**: Architect writes a `_session_state.md` block to `~/aether/` at any productive session end. Gitignored. Survives time gaps.

10. **Subagent delegation**: read-heavy exploration belongs to `aether-explorer` (Haiku). Build belongs to `aether-implementer` (Opus). Pre-PR review belongs to `aether-reviewer` (Sonnet). See `.claude/agents/`.

11. **Verify-then-ship sequencing**: every Implementer prompt ends with the `verify-build` skill, then (only on Director's "clean, proceed") the `ship-it` skill. Sequential, not concurrent. Resolves the verify-clean stall pattern observed in #65–#67.

12. **One issue per lane**: every lane opens a GitHub Issue using `.github/ISSUE_TEMPLATE/lane.yml`. PR body uses `Closes #<issue>`. Backlog visible in Issues, not buried in chat.

## 13.8 Architect Pre-flight Checklist

Before drafting any new-lane prompt, the Architect runs this checklist to
surface the choke-file landscape and hardcoded-list traps that have bitten
prior lanes (Sprint 4 #73, #74, #75 each missed one of these).

Required pre-flight reads, in order:

1. `ls .github/ISSUE_TEMPLATE/ .github/PULL_REQUEST_TEMPLATE/` — confirms
   whether issue/PR templates exist before the prompt references them.
2. `wc -l manifest.yaml docs/new-node-pattern.md` — confirms choke-file
   status of the two largest non-data files in the repo.
3. `wc -l shell/electron/main/services/*.ts | sort -rn | head -5` —
   surfaces the five largest service files; anything over 200 lines is
   choke-track.
4. `grep -n "pnpm --filter" .github/workflows/*.yml` — surfaces the CI
   pre-build list (currently bites every new SDK-shape package, see
   PR #75 CI failure for the canonical case).
5. `grep -n "pnpm --filter" shell/package.json` — surfaces the shell
   prebuild filter; same maintenance trap as the CI workflow's pre-build.
6. If the lane references `_ingest/` patterns, confirm at least one
   existing Aether node was read alongside (per §13.4 — _ingest/ patterns
   are facts about source repos, not facts about Aether, until verified).

This checklist is a tax on the Architect, not the Implementer. The output
shapes the prompt's LARGE-FILE CAUTION section, INITIAL READ list, and
SHELL HOOKS list (which must include any hardcoded package lists discovered).

## 13.9 Manual Completion Fallback

When a CC session stalls in the read phase (per §13.7's 5/10 retry
protocol) and a restart hits the same wall, manual completion is the
documented fallback. Used three times in Sprint 4 (Wave 2 #73, #74
recovery, #75 mid-lane recovery).

The pattern:

1. Director catches the stall (per §13.7 protocol).
2. Director cats reference files to the Architect chat (typically: a
   reference node's source files + the relevant shell hook files).
3. Architect dictates the new files as `cat > path << 'EOF' ... EOF`
   blocks and the shell hook patches as Python `str_replace` scripts.
4. Director pastes blocks into the worktree, runs `verify-build`,
   commits, pushes, opens PR.
5. PR body's "Risks / TODOs / Skipped" section notes the lane was
   completed manually due to CC unavailability.

Cost: ~30 minutes per node. Reserved for hostile-API days when CC
cannot land the work. NOT a default — CC remains the primary
implementation channel. See `docs/manual-completion.md` for the
full mechanics, including which file types convert cleanly to
cat-heredocs and which require Python patches.

## 13.10 Hand-Edit Lanes and the Manual-Completion Kit

§13.9 documented "manual completion" as a single fallback pattern (Director-Architect paste-and-write when CC stalls). Sprint 5 expanded this into a five-shape kit. The shapes are interchangeable tools, not a hierarchy.

The five shapes documented across PRs #65, #66, #110, #112, #113, #114, #115:

1. **Implementer-wrote-Director-shipped.** CC drafts the code; Director runs verify-build and ships via manual commit + push. PRs #65, #66.

2. **Implementer-stalled-Director-finished.** CC drafts partial code, then stalls mid-write (read-retry storm OR network drop). Director picks up where files-on-disk left off, finishes the surgical edits, ships manually. PRs #110, #112, #113 verify phase.

3. **Hand-written documentation lane.** No CC session at all. Architect drafts prose content in chat, Director pastes to disk via `cat > path << 'EOF' ... EOF`, commits and ships. First applied to PR #114 (roadmap doc); reusable for retrospectives, ADR-heavy lanes, governance docs. Content must be direct compression of recent chat conversation — if Architect needs to reverse-engineer from PR bodies, prefer CC.

4. **Hand-edit code lane spanning calendar days.** Director starts hand-edits one session, pauses, resumes hours or days later. Uncommitted branch state on disk is valid persistent storage between sessions. Pattern works without modification — no special "resume protocol" needed beyond `git status` to remind yourself what's pending. PR #115.

5. **Architect-Director hand-completion after BOTH CC sessions stall.** Two consecutive CC sessions hit network errors mid-write; Director assembles final state across the two partial outputs, runs verify-build, ships. PR #113 across two sessions ~30 minutes apart.

Across all five shapes:
- Files persist on disk between sessions; this is the load-bearing invariant.
- Resume prompts (when used) run 30–40% the size of original prompts because they reference already-on-disk contracts as locked.
- §7 canonical PR body discipline holds regardless of session count or shape — the PR body should explain shape in the "Risks / TODOs / Skipped" section.
- Verify-build is the universal pre-ship gate. Hand-completion never skips it.

When to use which shape (default heuristics):
- Code work, fresh lane → CC (default; no kit needed).
- Code work, CC stalls → shape 2 or 5.
- Documentation, content fresh in chat → shape 3.
- Small surgical edits (≤5 files, no architectural decisions) → shape 4 directly.
- Mixed lane spanning multiple days → shape 4 with daily verify-builds.

The kit is now stable. Future Sprint retros bank new shapes here as they emerge.

## 13.11 Bundle-Size Reporting in Deletion Lanes

Deletion lanes (PRs that primarily remove code) should report renderer bundle delta in the §7 "Verification" section. Serves as a smoke gate confirming the deletion actually took effect rather than leaving dead references somewhere.

Example: PR #115 removed three content-app directories. Renderer JS dropped from 1,012 KB to 622 KB (~39%); renderer CSS dropped 23.54 KB to 18.66 KB (~21%). The numeric drop confirmed no orphan imports.

Format in PR body: include `pnpm -r build` output's bundle size lines under "Verification," noting delta from previous build.

---

*End of CLAUDE.md. If you reached this line and something above contradicts itself, or doesn't cover a situation you hit, raise it in the next PR's description under "Open questions for Architect." This file is meant to grow.*
