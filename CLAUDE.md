# CLAUDE.md — Aether Operating Instructions

> **Audience:** Claude Code Opus, the implementer for this repo.
> **Authority:** This file is the operating manual. `MASTER_SYNTHESIS.md` is the architecture briefing. When they conflict, this file wins for *workflow*; `MASTER_SYNTHESIS.md` wins for *architecture intent*. When in doubt, ask the Architect (see Roles).

> **Current state: pre-implementation.** The directories, commands, and files
> referenced below (`shell/`, `pnpm dev`, etc.) do not exist yet. The §11 task
> is what creates them. After PR #1 merges, this file becomes accurate.

> **Reference appendix.** Long worked examples, historical PR lists, shape
> histories, and extended rationale relocated to `docs/claude-reference.md`
> (anchors match the section numbers here). This file keeps the operating law;
> the appendix keeps the detail. It is indexed by the `aether-rag` corpus.

---

## 1. Roles & Operating Model

A four-party project. Internalize it — most of your behavior is shaped by where you sit.

| Role | Who | What they do | What they don't do |
|---|---|---|---|
| **Director** | The human user | Sets vision. Picks direction. Approves merges. Pastes diffs/PR URLs into chat with Architect. | Writes code. Reviews diffs line-by-line. |
| **Architect** | Claude Opus 4.7 in a chat session | Translates Director's vision into PR-ready task specs; reviews your PRs when Director surfaces them; maintains `MASTER_SYNTHESIS.md` and this file; writes your prompts at max thinking depth. | Writes code. Pushes to repo. |
| **Implementer** | You (Claude Code Opus) | Write all code. Open PRs, self-review, address review notes, surface blockers in PR comments. | Push directly to `main`. Silently expand scope. |
| **Merge gate** | Director | Approves the merge after Architect signs off. | Architect-signs-off doesn't auto-merge; Director presses the button. |

**Flow of a unit of work:**

1. Architect writes a task spec in chat. Director reviews and approves or tweaks.
2. Director hands the spec to you (Claude Code) by paste.
3. You implement on a feature branch. Open PR. Fill out the §7 self-review template.
4. Director drops the PR URL in chat with Architect.
5. Architect reviews via web_fetch and responds in chat. **If clean:** Director runs any visual checks Architect flagged, then merges. **If request-changes:** Director copy-pastes Architect's chat reply as a single PR comment.
6. You read the PR comment via `gh pr view <n> --comments`, address the requests, push the fixup, and post a follow-up PR comment summarising what changed.
7. Architect re-reviews via web_fetch. Loop on the PR (not in chat) until clean.
8. Director merges — (a) the GitHub merge button, (b) `gh pr merge` in a plain terminal, or (c) authorizing Implementer to run `gh pr merge` via paste in chat (Implementer executing Director's intent, not a unilateral merge). Architect cuts the tag.

**On tag-cutting.** Architect "cuts the tag" by writing the annotation message (the architectural work) but can't push from chat, so Director runs `git tag -a` + `git push origin <name>`, personally or by authorizing Implementer via paste — same delegation as the merge button.

You never push to main. The review *conversation* lives on the PR; Director↔Architect chat is for direction-level decisions and visual-test feedback.

---

## 2. Project Context (read once, then refer to `MASTER_SYNTHESIS.md`)

Aether (working name homeOS through v0.3.x — see DECISIONS.md "Rename project homeOS → Aether") is an always-on personal OS — "Jarvis from Iron Man, realistic."

**Eventual scope** is ambient computing — mics, speakers, projectors, cameras, sensors, actuators through a home, with a software workspace as the *first surface*. Two halves: the **home substrate** (always-on, on a small machine close to the hardware; runs Core + physical-domain nodes; autonomous via sensors and policies) and the **workspace** (the Electron app on the laptop; a mesh client; command-driven via voice, text, agents, dashboards). **Current reality** is smaller: solo dev on a MacBook Pro, no always-on box yet, single-user, a Windows collaborator on a parallel stack to converge later — we design *for* the two-machine future while temporarily single-machine. Full orientation: `docs/claude-reference.md` §2.

**Source material** under `_ingest/` — vendor reference (copy freely, never import at runtime): **Pulse** (*the engine room*; read its `CLAUDE.md` for gotchas), **RAVEN_MESH** (*the spine*), **NEXUS** (*runtime concepts to lift*; read its `AUDIT.md` before lifting route/container code — 70 findings, many CRITICAL), **VIEWER** (*the surface*). Per-repo detail (tech stacks, what each contributes): `docs/claude-reference.md` §2.

For the full architectural picture — capability matrix, per-repo teardown, integration seams, conflicts, eventual phase ordering — see `MASTER_SYNTHESIS.md`.

---

## 3. Strategic Direction (Week 1)

**Top-down. Surface first. Mesh awakens late.** Build the visible Electron shell on Day 1, fake the backend, add real services behind the fakes incrementally; the mesh ("the spine") earns its weight on Day 5+ when there are multiple things to connect, not before. Rationale: Director attention is the bottleneck, not Claude Code throughput — plumbing-first work (vendoring RAVEN_MESH, the TS SDK, a manifest validator) gives Director nothing to react to for days and kills momentum. Visible progress drives direction; direction drives architecture.

Week 1 deliberately *deviates* from `MASTER_SYNTHESIS.md` §6's phase ordering (correct for a production push; we're vibe-coding for velocity now) — once week 1 closes and there are multiple surfaces, we converge with the doc's plan or update it, recording the divergence in `DECISIONS.md`. The informal week-1 phasing (PR #1 `feat/shell-skeleton`, then first canvas app, faked data layer, voice): `docs/claude-reference.md` §3.

---

## 4. Repo Layout (target)

Top level: root docs (`CLAUDE.md`, `MASTER_SYNTHESIS.md`, `DECISIONS.md`, `CHANGELOG.md`, `README.md`); `_ingest/` (vendor reference, never imported); `shell/` (the Electron workspace surface — `electron/{main,preload}`, `src/{apps,stores,theme,lib}`); then, as the mesh awakens, `core/` (RAVEN_MESH core + Python/TS SDKs + schemas), `manifest.yaml` (the edge graph), `nodes/<name>/`, `agents/{agentId}/` (per-agent ledgers), and gitignored `data/` (`aether.db`, `workspaces/`, `.mesh/audit.log`). Full annotated tree: `docs/claude-reference.md` §4.

For week 1 only `shell/` matters. Everything else gets created as we earn it.

---

## 5. Branching Standards

**Trunk-based with short-lived feature branches.**

- `main` — always working. Never broken. You never push to it directly.
- `feat/<scope>` — new functional work. Scope hyphen-delimited and narrow: `feat/shell-skeleton`, `feat/news-node`.
- `chore/<scope>` — plumbing, deps, config, tooling: `chore/eslint-config`.
- `fix/<scope>` — bug fixes against `main`: `fix/splash-race`.
- `exp/<idea>` — exploratory branches that may never merge (free-form scope). Use when Architect says "try something and we'll see."

**Branch lifetime:** hours to a few days. A branch over five days unmerged should be raised in the PR — likely it should be split. **Commits inside a branch:** prefer many small commits; squash-merge to `main`, so the PR is the unit of history.

**Commit message format:**

```
<type>(<scope>): <short imperative summary>

<optional body — what + why, not how>

<optional footer — refs #issue, breaking changes, etc.>
```

Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `style`, `perf`.

Examples: `feat(shell): boot Electron with holographic-theme splash` · `chore(deps): pin jsdom@24 — v25+ breaks Electron CJS require` · `refactor(theme): extract CSS vars to theme/holographic.css`

---

## 6. Tagging Standards

Honest pre-1.0 versioning. **Architect cuts tags**, not you — land changes with the tag boundary in mind, and let the changelog reflect the intended cut. The four tiers — `v0.0.x` (pre-mesh), `v0.1.0` (first end-to-end mesh hop, "the spine is alive"), `v0.x.0` (each new node *category*: news/finance/voice/agents, order TBD by Director), `v1.0.0` (deployable by another household without Architect babysitting — **not soon**) — with full cut-when criteria: `docs/claude-reference.md` §6. Tags are annotated, signed if the environment supports it, pushed to origin; each corresponds to a `CHANGELOG.md` section.

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

At repo root. Touch whenever a `MASTER_SYNTHESIS.md §4` conflict gets a verdict, a `MASTER_SYNTHESIS.md §7` open question gets answered, or you discover a constraint mid-implementation that forecloses or commits to a future path.

Entry format. All six fields are **required**, in this order — `Status`, `Decided by`, `Context`, `Decision`, `Consequences`, `Alternatives considered` (header line `## [YYYY-MM-DD] <Title>`). An ADR missing any gets rejected at review and amended in the same PR. The six fields are the binding shape of an Aether ADR; the rest (prose, sub-bullets, links) is freeform. Fill-in template: `docs/claude-reference.md` §8.

DECISIONS.md is *append-only* — never edit a past entry. If a decision is reversed, add a new entry that supersedes it and update the old entry's status to `superseded by [link]`. Ordering: newest at top within a date; dates descending overall.

### CHANGELOG.md

Keep-a-Changelog format (`## [Unreleased]` → `### Added / Changed / Fixed / Removed`). Add a single line per PR under `[Unreleased]`; when Architect cuts a tag, `[Unreleased]` rolls into the new version section. Fill-in template: `docs/claude-reference.md` §8.

---

## 9. Task Spec Format (how Architect briefs you)

Architect will send each PR's work in a fixed shape — sections **Goal** (one sentence), **Why**, **Branch**, **Scope (DO)**, **Out of Scope (DON'T)**, **Acceptance criteria**, **Notes / hints**, **Open questions**. The full template: `docs/claude-reference.md` §9. **If something is missing or ambiguous, ask in chat before opening the PR — don't guess.**

**Scope discipline.** If during implementation you find that the spec is wrong, or that finishing the goal requires work that's clearly out of scope: **stop and surface it in the PR description or a comment on the chat thread that holds the spec.** Don't silently expand. Architect would rather split a PR than receive a sprawling one.

---

## 10. Hard Gotchas (lifted from `_ingest/` learning)

See `docs/governance-log.md` for the full governance log (Sprint 1 baseline plus accumulated batches). New batches append there, not here.

## 11. Architect Review Heuristics (self-apply before opening any PR)

Patterns Architect repeatedly flags in review. Self-apply them BEFORE opening a PR — each caught early saves a round-trip. If you deviate, flag it in the §7 self-review under "Risks / TODOs / Skipped" with reasoning.

1. **Semantic ordering, not alphabetical.** Order user-facing items (nav buttons, dropdown options, table rows) by importance/flow/reading order. Set explicit `AppDefinition`-style ordering keys where they exist. Never rely on `id.localeCompare` for anything the user sees.

2. **UI near window edges must respect platform chrome.** macOS traffic lights occupy ~12–80px top-left under `titleBarStyle: 'hiddenInset'`; Windows controls ~135px top-right under custom title bars. Any nav/header/toolbar reaching a window edge needs a platform-conditional inset AND `-webkit-app-region: drag` on the empty strip (`no-drag` on interactive elements).

3. **Code/comment accuracy.** Comment numerics must match the code (`setTimeout(180)` is "180ms," not "two frames"). React timing: `useEffect(() => {...}, [])` fires after the first commit; synchronous code after `ReactDOM.createRoot().render(...)` fires before it. "After mount" ≠ "after paint."

4. **Pre-flight before destructive operations.** Before any `rm -rf`, `git push --force`, schema migration, or filesystem mutation: capture rollback data, validate preconditions, surface blockers in the PR (or to Architect). Order: capture → validate → mutate, never the reverse.

5. **Atomic git state hygiene.** In `git status --short`, column 1 is staged, column 2 is working-tree — ` M file` (leading space) is NOT in the next commit. Read the column semantics, not just the filename. `git diff --staged` is ground truth for what commits.

6. **Reserve space for future entries.** When introducing ordering keys (`order: 50`), enum values, port numbers, or version slots, leave gaps: 0/50/100/150 admits later insertions, 0/1/2/3 doesn't.

7. **Cross-platform UI debts must be explicit.** Any macOS-only styling, IPC, or Electron API needs (a) an explicit PR note ("Mac-only this PR; Windows path TODO") and (b) ideally a `process.platform === 'darwin'` guard, not a silent assumption. The collaborator's Windows tree must not need to undo silent macOS choices.

8. **Pattern-lifting from `_ingest/` should aggressively simplify.** When adapting Pulse/VIEWER/NEXUS/RAVEN_MESH code, cut what we don't need yet (multi-window, file types, OAuth, retry queues). Document what was cut and why in the PR, and in DECISIONS.md if the cut is non-obvious or reversible.

9. **Cross-doc consistency.** When a literal phrase, version number, package name, or terminology choice appears in more than one of CLAUDE.md / MASTER_SYNTHESIS.md / DECISIONS.md / CHANGELOG.md / README.md / docs/*.md, treat the set as one surface: pick the canonical form, grep for the others, fix every divergence in the same PR (entries dated before the divergence stay policy-preserved verbatim — flag them in the §7 self-review so drift isn't read as inconsistency). A passing typecheck never catches doc drift — only a literal grep does. Drift vectors + worked detail: `docs/claude-reference.md` §11.9.

10. **Pre-decide load-bearing decisions; leave non-load-bearing to Implementer.** Lane prompts pre-commit decisions that affect downstream consumers, the substrate, or the wire contract; leave non-load-bearing local choices (layout, edge rendering, animation) explicitly open with "pick whichever you can implement cleanly; document choice in PR body" — the Implementer has fuller context at write-time, and the choice ships with reasoning attached. Zero non-load-bearing choices to delegate ⇒ probably over-specified. Worked example (PR #113 radial): `docs/claude-reference.md` §11.10.

11. **Hand-written documentation lanes don't need CC.** When PR content is direct compression of recent Architect-Director conversation (retros, ADRs, roadmap edits, governance updates), CC adds overhead with no value — Architect drafts in chat, Director pastes via heredoc and ships (see §13.10 shape 3). Do NOT use this for code lanes; CC's structural review (`grep`, file reads, typecheck) is real value. PR history: `docs/claude-reference.md` §11.11.

This list will grow. When Architect flags a new recurring pattern, add it here in a follow-up PR.

---

## 12. Architectural Patterns

Named patterns that have earned their weight across ≥1 binding architectural decision — named so future PRs can say "applying the three-tier auth pattern" without re-deriving the rationale. Each entry names the pattern, summarizes the shape, cites its binding ADR(s).

### 12.1 Three-tier auth: shell-UX / core-protocol / secret-store

Any third-party integration requiring user-bound auth (OAuth, API keys, signed tokens) splits across three tiers that must not be collapsed: **shell-UX** (Electron — OAuth consent, loopback-redirect capture, connection state; the only tier the user sees), **core-protocol** (raven-core — MCP/REST/GraphQL calls, token refresh, the typed adapter; reads tokens, never prompts the user), **secret-store** (macOS Keychain under `com.aether.app` — the only tier that persists tokens at rest; written by shell-UX, read by core-protocol). Boundaries are load-bearing because each tier fails differently (UX → user affordance; protocol → retry/refresh; secret-store → OS-level error); label tier ownership in the task spec and split any function spanning two. **Bound by:** DECISIONS.md "MCP integration arc roadmap" (2026-05-14). Full definition + rationale: `docs/claude-reference.md` §12.1.

This section will grow: when an ADR introduces a pattern that will recur (not a one-off), name and add it here in the same PR.

---

## 13. Communication Style

### In PRs
- Be specific. "Refactored layout" is useless; "moved tray-icon assembly from `index.ts:189-213` into `services/trayIcon.ts:setup()` so splash sequencing stays in one file" is useful.
- Flag risk explicitly. Skipped a test, used a workaround, noticed something off-spec? Surface it in "Risks / TODOs" — don't hide it.
- Don't apologize. State the thing, propose a fix, move on. Architect cares about progress, not contrition.

### Mid-task signals to Architect
Surface blockers two ways: (a) a PR comment for anything tactical, or (b) asking Director to ping Architect in chat for anything strategic.

Helpful patterns: "I hit X and the spec didn't anticipate it. [A] keeps scope, [B] expands 30%. Defaulting to A unless you say otherwise." · "MASTER_SYNTHESIS.md says X but `_ingest/Pulse` does Y. Going with Y; flagging for DECISIONS.md." · "Z is out of scope but obviously right — splitting into follow-up PR `feat/z`."

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

CLAUDE.md is authored by Architect with Director's approval. If Director says something in chat that contradicts it, two cases:

1. **Director is intentionally changing direction.** Then CLAUDE.md should change too — surface it in the PR description ("this PR also updates CLAUDE.md to reflect...").
2. **Director is making a one-time exception or speaking imprecisely.** Then proceed with what they said, noting the divergence in DECISIONS.md if it matters.

When unsure, **ask Director in chat which of these it is.** Don't decide unilaterally.

---

## 15. Velocity Notes

- Vibe-coding for velocity *in week 1 only*: boring correctness loses to visible progress. After v0.1.0, we tighten.
- "Tests" in week 1 = smoke tests that the thing runs. Unit tests come once a module stabilizes — premature unit tests on rapidly-changing code are negative-value.
- Premature optimization is forbidden; premature *abstraction* too — don't generalize from one example. Wait for the third instance before extracting a shared utility.
- Aesthetic quality of the shell matters disproportionately. The holographic theme is not decoration — it's what Director stares at while directing. If it looks bad, it gets fixed; "ugly but works" is unacceptable for the surface.

---

## 16. Glossary

Defined terms — the mesh/spine, the substrate, the workspace/surface, a node, a surface (two senses), the ledger, the edge graph, a skill, `_ingest/`. Full definitions: `docs/claude-reference.md` §16.

---

## §13. Implementer Prompt Discipline

Every Implementer prompt is drafted by the Architect against the canonical template at `docs/implementer-prompt-template.md` and MUST include:

1. **Lane type tag** at the top: `LANE TYPE: TUNING | NEW-SURFACE | NEW-NODE | REFACTOR | CHORE | DOCS`. Orients the Implementer to the kind of work; reduces scope-drift risk.

2. **Pre-flight reads completed by Architect** — grep/file findings BEFORE drafting, capturing architectural facts (e.g. "feature X already exists at file Y"). Mandatory: skipping it twice in Sprint 4 produced wrong-scoped prompts that wasted Implementer sessions (#66, #67).

3. **Large-file caution block** listing every file > 400 lines in scope, each with explicit `grep + view line_range` instructions (full-reads of these are the single biggest cause of session retries on API-hostile days). Current known choke files: `ravenDaemonManager.ts`, `nodeRegistry.ts`, `manifest.yaml`, `docs/new-node-pattern.md`, `coreManager.ts`, `.github/workflows/ci.yml`. Line counts, growth rates, read strategy, and the PR #80 `DECISIONS`/`CHANGELOG` note (regrowth threshold ~800 lines): `docs/claude-reference.md` §13.3. Update both lists when a new file breaches 400 lines.

4. **Pre-staged context** when API symptoms in the past 24h, the lane requires 5+ file reads, or scope includes a known choke file: Architect dumps relevant file content inline so the Implementer's first action is a write, not a read.

5. **Lane scoping rules**: split when files touched > 8, cumulative changes > 500 lines, or scope spans multiple unrelated subsystems.

6. **Hard parallelism policy**: sequential sessions by default; parallel only after 24h of clean API readings.

7. **Stall protocol**: 3+ min of silent tool calls = interrupt and assess; 5/10 read-phase retries = let the session bail; 10/10 = preserve-or-restart decision.

8. **Pulse/RAVEN hoisting language**: lanes lifting patterns from `_ingest/Pulse/` or `_ingest/RAVEN_MESH/` get explicit consult instructions naming the source files and pattern.

9. **Session-end checkpoint discipline**: Architect writes a `_session_state.md` block to `~/aether/` at any productive session end (gitignored; survives time gaps).

10. **Subagent delegation**: read-heavy exploration → `aether-explorer` (Haiku); build → `aether-implementer` (Opus); pre-PR review → `aether-reviewer` (Sonnet). See `.claude/agents/`.

11. **Verify-then-ship sequencing**: every prompt ends with `verify-build`, then (only on Director's "clean, proceed") `ship-it`. Sequential, not concurrent. Resolves the verify-clean stall pattern (#65–#67).

12. **One issue per lane**: every lane opens a GitHub Issue (`.github/ISSUE_TEMPLATE/lane.yml`); PR body uses `Closes #<issue>`. Backlog visible in Issues, not buried in chat.

## 13.8 Architect Pre-flight Checklist

Before drafting any new-lane prompt, the Architect runs a six-read checklist for the choke-file landscape and hardcoded-list traps that bit prior lanes (Sprint 4 #73–#75): issue/PR template presence; `wc -l` on the two largest non-data files; the five largest service files (>200 lines = choke-track); the CI and shell `pnpm --filter` pre-build lists (the SDK-shape-package trap); and an existing Aether node read alongside any `_ingest/` pattern (per §13.4). It shapes the prompt's LARGE-FILE CAUTION, INITIAL READ, and SHELL HOOKS sections (the last must include any hardcoded package lists found). Exact commands + rationale: `docs/claude-reference.md` §13.8.

## 13.9 Manual Completion Fallback

When a CC session stalls in the read phase (per §13.7's 5/10 retry protocol) and a restart hits the same wall, manual completion is the documented fallback (used 3× in Sprint 4): Director cats reference files to the Architect chat, Architect dictates `cat`-heredoc files + Python `str_replace` hook patches, Director pastes, runs `verify-build`, commits, pushes, opens a PR whose "Risks / TODOs / Skipped" notes it. Reserved for hostile-API days, NOT a default. Mechanics: `docs/manual-completion.md`; the five-step pattern + cost: `docs/claude-reference.md` §13.9.

## 13.10 Hand-Edit Lanes and the Manual-Completion Kit

§13.9 documented "manual completion" as a single fallback; Sprint 5 expanded it into a five-shape kit and Sprint 6 added a sixth (the hand-edit hotfix, #134). The shapes are interchangeable tools, not a hierarchy:

1. **Implementer-wrote-Director-shipped** — CC drafts; Director verify-builds + ships via manual commit/push.
2. **Implementer-stalled-Director-finished** — CC stalls mid-write; Director finishes the surgical edits from files-on-disk and ships.
3. **Hand-written documentation lane** — no CC; Architect drafts prose in chat, Director pastes via heredoc. Content must be direct compression of recent chat.
4. **Hand-edit code lane spanning calendar days** — uncommitted branch state on disk is the cross-session store; no resume protocol beyond `git status`.
5. **Architect-Director hand-completion after BOTH CC sessions stall** — Director assembles final state across two partial outputs, verify-builds, ships.
6. **Architect-dictated hand-edit hotfix** — no CC by design; an exactly-diagnosed fix where CC would only add latency. Architect dictates, Director applies + validates with an isolation smoke read from daemon-side truth (not an optimistic CLI echo). Distinct from shapes 2/5 (stall *recoveries*).

Invariants across all shapes: files persist on disk between sessions (the load-bearing invariant); resume prompts run 30–40% the size of originals; §7 PR-body discipline holds regardless of shape (explain the shape in "Risks / TODOs / Skipped"); verify-build is the universal pre-ship gate, never skipped. Default heuristic: fresh code → CC; CC stalls → shape 2 or 5; docs fresh in chat → shape 3; ≤5-file surgical edits → shape 4; exactly-diagnosed fix → shape 6. Full descriptions, the when-to-use table, and PR histories: `docs/claude-reference.md` §13.10.

## 13.11 Bundle-Size Reporting in Deletion Lanes

Deletion lanes (PRs that primarily remove code) report renderer bundle delta in the §7 "Verification" section — `pnpm -r build`'s bundle-size lines vs the previous build. It's the smoke gate confirming the deletion took effect rather than leaving dead references. Worked example (PR #115's ~39% JS / ~21% CSS drop): `docs/claude-reference.md` §13.11.

## 13.12 Full-Stack Worktree Setup

A fresh worktree is not a fresh clone: `git worktree add` does NOT init submodules, copy gitignored config (`.env.local`), or materialize `node_modules` for workspace packages. Any lane running the full stack (scene server, voice, a new workspace package) needs all three. The canonical setup recipe and the submodule-`deinit`-before-`worktree remove` teardown gotcha (`deinit` is GLOBAL across worktrees sharing a `.git`): `docs/claude-reference.md` §13.12 and `docs/governance-log.md` (2026-06-03).

## 13.13 Precedent-First Implementers

The default way an Implementer discovers prior art is to **query the `aether-rag` MCP (`search_corpus`) for the decisions and patterns relevant to each build step, before implementing it** — not to wait for the lane prompt to hand-list every file. The corpus is Aether's own written record (governance log, DECISIONS, CHANGELOG, CLAUDE.md, scene protocol, the manifest, node READMEs, `docs/rebase-playbook.md`, this appendix), so "how have we solved this before?" is a retrieval, not a guess — replacing exhaustive hand-fed file lists as the *default* for discovery.

What does NOT change: **hand-named precedents remain for load-bearing reads** — files whose exact contract must not be gotten wrong (wire formats, the named source in a `_ingest/` pattern-lift, a choke-file region), still governed by §13 items 2–4. Rule of thumb: if getting a file wrong breaks the build or wire contract, name it; else let `search_corpus` find it. Caveat — **the index only retrieves law that is *written*.** Oral law (living only in chat or the Architect's head) is invisible until banked in a corpus file; when you rely on an unwritten convention, write it down so the next lane can retrieve it. Extended rationale: `docs/claude-reference.md` §13.13.

## 13.14 Open-Own-Issue Default

A lane that arrives **without a supplied GitHub Issue opens its own** (using `.github/ISSUE_TEMPLATE/lane.yml`) and proceeds — it does not pause to ask "should I open an issue?". If the spec supplies an issue number, use it; absent one, open it and carry on. The PR body still references it with `Closes #<issue>` (§13 item 12, *One issue per lane*); this subsection fixes *who* opens it when the spec is silent: the Implementer, not a round-trip to the Director.

---

*End of CLAUDE.md. If you reached this line and something above contradicts itself, or doesn't cover a situation you hit, raise it in the next PR's description under "Open questions for Architect." This file is meant to grow.*
