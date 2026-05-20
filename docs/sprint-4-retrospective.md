# Sprint 4 Retrospective

**Sprint window:** 2026-05-15 → 2026-05-20 (6 calendar days, ~PST)
**Version arc:** v0.5.0 → v0.9.0
**PRs merged:** 13
**Lanes:** Wave 1 (4) + process discipline (1) + Wave 2 (3) + Wave 3 (5)

## Sprint summary

Sprint 4 was the project's largest sprint to date — 13 PRs across three waves, plus this retrospective lane. The two main threads were data breadth (three new macOS daemon nodes plus a shared AppleScript bridge primitive) and process discipline (a codified Implementer prompt protocol, manual-completion fallback, and ~14 banked lessons).

The version arc — v0.5.0 → v0.9.0, four version bullets in the README — reflects how much surface shipped: voice extensibility consolidation (Sprint 2 retroactive), substrate consolidation (the `registerNode` factory pattern from earlier sprints), data breadth (Wave 2), and process discipline codification (#69). The README was updated mid-Wave-3 (#81) to label v0.9.0 as the current state, establishing the convention *"current state = next milestone in active development"* — what's substantively in main, not what's been formally tagged.

This retrospective documents what shipped, what process patterns emerged, what got banked as lessons, and where Sprint 5+ is headed.

## Wave 1 — Process work (#64–#67)

Four PRs landed in Wave 1, all process-work flavored:

- **#64** — Governance log extraction. Split a growing list of operational lessons out of `DECISIONS.md` into a dedicated `docs/governance-log.md`, establishing it as the canonical home for cross-PR observations that don't rise to ADR level.
- **#65** — Persistent finance cache. Switched the finance node's in-memory snapshot to per-node SQLite so cold restarts don't lose recent quote data.
- **#66** — News `urgency_reason` field. Extended the news node's per-article schema with a free-text `urgency_reason` field for downstream UI surfacing.
- **#67** — Splash dismiss gating. Tightened the shell's splash-dismiss logic so the splash window doesn't close until at least one mesh node has registered, preventing the user from seeing a "no mesh" state mid-launch.

Wave 1 was light by design — the larger Wave 2 lanes were already drafted but pending. The four small lanes ran cleanly and were useful in their own right, but the bigger story from Wave 1 was *what they surfaced*. Each lane had to navigate aspects of the operating model — large-file editing, lockfile handling, shell-hook ordering, PR body discipline — that hadn't been formally written down. By the end of Wave 1, ten distinct patterns had emerged worth codifying.

That observation drove #69.

## #69 — Process discipline codification

PR #69 introduced **`CLAUDE.md` §13** — *Implementer Prompt Discipline* — a 12-point operating model for how the Architect drafts prompts and the Implementer executes lanes. The discipline emerged from Wave 1's lessons and was sharpened against Wave 2's first lane (#73 clipboard_history) before being formally codified.

§13's core moves:

1. **Lane-type framing.** Every prompt names a lane type (NEW-NODE, EXTEND-EXISTING-NODE, REFACTOR, GOVERNANCE, DOCS), which sets the expected file-touch surface.
2. **Pre-flight reads.** The Architect lists what the Implementer should read first — typically a reference lane (a recently-merged PR with the same shape) plus the relevant shell-hook services.
3. **Locked architectural decisions.** Decisions the Implementer cannot deviate from — node id, package name, persistence model, cadence, validation rules — are listed explicitly so they don't get re-litigated mid-lane.
4. **File-touch list.** The prompt enumerates which files the lane will touch. CHOKE FILES get targeted-edit-only treatment.
5. **CHOKE FILES list.** Files that exceed ~800 lines cannot be full-read by the Implementer; only grep + str_replace edits allowed.
6. **Lockfile order.** `pnpm install` must run *before* `git add -A` so the lockfile is committed.
7. **Verify-build skill.** A skill that runs `pnpm install`, asserts lockfile clean, runs `pnpm -r typecheck` and `pnpm -r lint`.
8. **Ship-it skill.** A skill that asserts pnpm-install-before-git-add, builds a §7-template PR body, opens the PR.
9. **Stall protocol.** Five retries on any read phase = stop and report; no infinite loops.
10. **Architect Pre-flight Checklist (§13.8).** A 9-point Architect checklist before drafting any Implementer prompt — `_ingest/` is for source repos not Aether, reference lane is named, CHOKE files identified, etc.
11. **Manual Completion Fallback (§13.9).** When CC sessions stall mid-lane, the Architect can dictate file contents via `cat`-heredocs and the Director executes them. This is a *proven* fallback, not a theoretical one (see Wave 2).
12. **Subagent personas.** Implementer, Architect, Reviewer, Tester — each with a specific scope.

The retro section that follows describes Wave 2's stall recoveries — each of which exercised one or more of these patterns and added refinement back into the discipline.

## Wave 2 — Data breadth + bridge primitive (#73, #74, #75)

Wave 2 was the substantive feature work of the sprint: three new macOS daemon nodes plus a shared AppleScript bridge primitive. The three nodes were chosen as a coherent batch — all macOS data sources, all polling-based, all per-node SQLite — to let the daemon-node pattern crystallize across three implementations and identify what was generic vs. node-specific.

### Wave 2 pre-flight — the Pulse-pattern miss and correction

Wave 2's first draft prompt referenced a Pulse-monolith pattern that turned out to be a *source-repo* fact — patterns about how Pulse organized its own code, not patterns Aether had adopted. The `_ingest/pulse/` directory in the worktree had been vended into the repo as historical reference material; the Architect's draft assumed it was Aether's actual pattern.

The catch happened in pre-flight review. The corrected pre-flight banked the first major Wave 2 lesson:

> **`_ingest/` patterns are facts about source repos, not Aether.** The Architect should never reference `_ingest/` files when describing what *Aether* does. They're historical artifacts vendored for reference, not specifications.

This is now `CLAUDE.md` §13.8 — the Architect Pre-flight Checklist's first item.

### #73 — clipboard_history (the canonical TS daemon-node template)

#73 became the canonical template for new TS daemon nodes. It established the 8-file structure (`package.json`, `tsconfig`, `eslint` config, `README`, `schemas/{surface}.json`, `src/index.ts` + `poller.ts` + `storage.ts`) and the 5 shell-hook touches (`secrets`, `paths` ENTRY, `coreManager` env, `nodeManager` spawn + `startAll`, `manifest` entry + raven edge).

The CC session for #73 stalled three times mid-lane — twice during the build-out and once near commit. The third stall triggered the first manual-completion run: the Architect dictated three source files as `cat`-heredocs, plus the 5 shell-hook patches via Python `str_replace` blocks. The Director executed them, ran verify-build manually, and shipped the lane.

This proved the manual-completion fallback as a real operational tool, not a theoretical backup. Time cost: ~30 minutes for the full manual run. The CC session would have shipped faster if it hadn't stalled, but the *recovery* time was bounded and predictable.

### #74 — macos_messages (the misdiagnosed stall)

#74 read `~/Library/Messages/chat.db` read-only at 30s cadence, with per-chat watermarks on `date_delivered` (Mac Absolute Time) and composite `UNIQUE(chat_id, message_id)` dedup via `INSERT OR IGNORE`. The interesting lesson from #74 wasn't the implementation — that mostly went smoothly — but the *triage*.

The CC session appeared to stall mid-lane. The Architect drafted a manual-completion fallback. Before dispatching it, the Director ran `git status` on the worktree and discovered that *the lane was essentially complete on disk*. The CC session had finished substantial work; the apparent stall was an API error at the commit step, after most of the implementation had already landed.

Lesson banked:

> **`git status` worktree as first triage move.** When an Implementer session appears to stall, the first check is not "let's restart the session" or "let's dispatch a manual-completion" — it's `git status` on the worktree. If the work is on disk, recovery is a 2-minute verify+ship, not a 30-minute rewrite.

This is now `CLAUDE.md` §13.9 — Manual Completion Fallback.

#74 also surfaced a CI failure that hadn't been seen before: lockfile mismatch on the merge commit. The lockfile had been generated locally but `pnpm install` hadn't been re-run *after* the final `git add -A`, so the committed lockfile was slightly stale. CI's `--frozen-lockfile` install rejected it. The fix was a force-push with an amended commit running `pnpm install` first.

Lesson banked:

> **`pnpm install` MUST run before `git add -A`.** Lockfile generation is a side effect of `pnpm install`. If the install runs at the *end* of a session as a verification step, the lockfile that gets committed may not match what `pnpm install` would produce on a clean checkout. Order: install, then stage, then commit.

### #75 — macos_mail + @aether/macos-applescript bridge primitive

#75 was the most architecturally interesting lane of Sprint 4. It added the macOS Mail node (polling Mail.app via AppleScript at 60s cadence), but more importantly, it introduced **`@aether/macos-applescript`** — a new shared primitive in `core/macos_applescript/` exposing a discriminated-result `runAppleScript(script, options)` API.

The bridge primitive design was the result of recognizing that future macOS-app daemons (Reminders, Notes, Calendar) would all need the same AppleScript invocation surface. Implementing it ad-hoc inside macos_mail would have meant re-implementing it inside each future node. Extracting it as a workspace package — same shape as `@aether/mesh-node-sdk` — turned a one-off into reusable substrate.

The bridge's discriminated-result API:

- `{ ok: true, stdout: string }` on success.
- `{ ok: false, kind: 'tcc_denied', detail: string }` on permission denial (detects both `(-1743)` and `not authorized` forms).
- `{ ok: false, kind: 'timeout' }` on SIGTERM timeout.
- `{ ok: false, kind: 'syntax_error', detail: string }` on AppleScript parse failure.
- `{ ok: false, kind: 'unknown', detail: string }` for everything else.

The mid-write CC stall on #75 was the third Wave 2 stall and led to the second manual-completion run. The Implementer had drafted the bridge package and most of the mail node scaffolding; the Architect dictated the remaining 4 source files manually. By this point the pattern was tight — manual completion of a single node takes ~30 minutes and is reliably reproducible.

#75 also surfaced a *new* CI failure mode that hadn't been seen before: fresh-worktree downstream typecheck failure. The new workspace package's `.d.ts` files hadn't been emitted, so other nodes' typecheck couldn't resolve `@aether/macos-applescript`. The shell-only `pnpm -r build` skipped some packages. The fix was a hardcoded `pnpm --filter @aether/macos-applescript build` line in `.github/workflows/ci.yml`'s pre-build step.

That fix raised a question: *should `pnpm -r build` run unconditionally before typecheck across the whole workspace?* The answer is probably yes, but it's a meaningful change to the verify-build skill and went into the governance log as a **Proposed ADR (2026-05-20)** — to be enacted in Sprint 5 unless a regression appears.

The Proposed ADR was *validated* later in this sprint (see #85 — time lane in Wave 3, where a fresh-worktree typecheck failed the same way and required `pnpm -r build` manually).

### Cross-Wave-2 observations

Three CC stalls across three lanes is a lot. Some patterns from the cumulative experience:

- **CC subagent stalls lose all work; main-session stalls preserve partial.** The macOS Mail bridge implementation had to be reconstructed from the Architect's prompt content because the subagent session was lost. In contrast, the #74 stall preserved everything because the main CC session held the state.
- **Stall recovery is predictable.** ~30 minutes for manual completion of a single new-node lane. This is bounded enough to plan around — Wave 3 lanes were drafted assuming the possibility of one stall per lane.
- **CHOKE files are a real friction tax.** Three of the lanes had to grep-and-window `manifest.yaml` (~530 lines) and `docs/new-node-pattern.md` (~847 lines) instead of full-reading them. The targeted edits worked, but the cognitive overhead added time and minor errors. (This drove #80's archive lane.)
- **macOS case-insensitive FS + case-sensitive git index can shadow files.** Encountered during Wave 2 — a renamed file was tracked by git but invisible to `ls` because of case-insensitivity. `git ls-files` is the diagnostic.

All these are in `docs/governance-log.md` as banked lessons.

## Wave 3 — Governance + closing features (#77, #80, #81, #84, #85)

Wave 3 closed the sprint with five PRs: two large governance lanes, one documentation refresh, and two small feature lanes.

### #77 — Governance batch 4

#77 codified the ten Wave-2 lessons into `CLAUDE.md` §13 (extending §13.3, adding §13.8 Architect Pre-flight Checklist and §13.9 Manual Completion Fallback), banked the lessons in `docs/governance-log.md`, and registered the Proposed ADR for `pnpm -r build` before typecheck. New companion doc: `docs/manual-completion.md` — a written record of the manual-completion pattern with step-by-step instructions for Director-Architect paste-and-write workflow.

Skill updates: verify-build now asserts lockfile clean and runs `pnpm -r typecheck` (not shell-only); ship-it now asserts `pnpm install` before `git add -A`.

The lane was manually completed — Architect-content-heavy editorial work where CC subagents add little value over direct dictation.

### #80 — Archive

The largest mechanical change of Sprint 4: `DECISIONS.md` and `CHANGELOG.md` were both on the §13.3 CHOKE FILES list and were materially slowing Wave 2 lanes during API-hostile periods. #80 split each into top-of-tree (active) and `docs/archive/` (historical) halves.

- `DECISIONS.md`: 2269 → 455 lines. Cut date 2026-05-14; older entries moved to `docs/archive/decisions-pre-2026-05-14.md`.
- `CHANGELOG.md`: 1051 → ~132 lines. Pre-Sprint-4 `[Unreleased]` entries moved to `docs/archive/changelog-unreleased-pre-sprint-4.md`.
- `CLAUDE.md` §13.3 updated to remove both files from CHOKE list (with regrowth threshold ~800 lines).

A small detail worth noting: #80 + #81 ran in parallel and both modified the `[Unreleased]` → `### Changed` section of `CHANGELOG.md`. Resolved via standard rebase + python patch on the conflict. The same pattern repeated for #84 + #85 in their `CHANGELOG` conflict. By the end of Sprint 4 the parallel-`CHANGELOG`-conflict resolution was a 2-minute routine.

### #81 — README update

The README hadn't been refreshed since #56 and still labeled the project as v0.5.0. #81 brought it to v0.9.0 with four version bullets (Sprints 2–4), updated the Architecture tree to include `core/macos_applescript/` and the three new daemon nodes, and added Status table rows for the new versions. Established the convention "current state = next milestone in active development" — to be banked as a §11 governance entry in a future small lane.

### #84 — system_info.processes surface

Small extend-existing-node lane: added a `processes` surface to the existing `system_info` node. `ps -axo pid,comm,%cpu,%mem,etime` with 5s in-memory cache. Capped at 200 records returned (default 50), sortable by CPU/memory/PID. No new shell hooks (the node is already registered) — single manifest entry update added the surface to `system_info`'s array.

CC stalled during the verify phase but the work was on disk. Verified manually from the terminal and shipped.

### #85 — time mesh node

Stateless new-node lane: added a mesh-routed `time.now({ zone?, format? })` surface backed by `Intl.DateTimeFormat`. First mesh-routed time surface; the existing raven internal "time" voice tool runs in-process and will be rewired to `mesh.invoke` in a follow-up lane.

The lane validated the Proposed ADR from #77: fresh-worktree typecheck on downstream nodes failed because `@aether/mesh-node-sdk`'s `.d.ts` files weren't emitted. The fix was `pnpm -r build` before typecheck — which is exactly what the Proposed ADR specified. Sprint 5's enacted ADR work will fold this into the verify-build skill.

CC stalled during verify; recovery was the now-standard "build manually from terminal + ship" routine. PR body explicitly flags the ADR validation.

## Lessons banked (10 from Wave 2 + 4 from Wave 3)

Banked in `docs/governance-log.md`. Summarized here for context:

### From Wave 2

1. `_ingest/` patterns are facts about source repos, not Aether (caught Wave 2 pre-flight).
2. `git status` worktree as first triage move (saved hours on #74).
3. CC subagent stalls lose all work; main-session stalls preserve partial.
4. CHOKE files require targeted grep + `str_replace`, never full-read.
5. `pnpm install` MUST run before `git add -A` (lockfile lesson from #74 CI failure).
6. `pnpm -r typecheck` not just shell-only (caught #75 CI failure).
7. CI pre-build list needs maintenance per new SDK-shape package; Proposed ADR for `pnpm -r build` replacement.
8. Manual completion via Architect-dictated cat-heredocs + Python `str_replace` patches is proven hostile-API fallback (~30 min/node).
9. macOS case-insensitive FS + case-sensitive git index can shadow files.
10. API errors at commit-step usually mean commit landed — verify via `git log` before assuming failure.

### From Wave 3

11. Parallel `CHANGELOG` lanes always conflict on `[Unreleased]` sections; resolution is mechanical (keep both bullets, ~2 min).
12. Build artifacts (`.d.ts` files) are per-worktree, not workspace-global — fresh worktree needs `pnpm -r build` before downstream typecheck (validates #77 Proposed ADR).
13. Manifest.yaml conflicts between Wave-3 parallel lanes auto-resolve when the lanes touch different node sections (#84 modified `system_info`'s surfaces, #85 added a new node entry — no overlap).
14. Director–Architect timezone calibration: Director is PST; pace expectations accordingly.

## Process iterations & open governance items

- **Proposed ADR (2026-05-20): `pnpm -r build` before typecheck.** Validated twice now (#75 CI failure, #85 verify failure). Sprint 5 should enact it — verify-build skill updated to run `pnpm -r build` before `pnpm -r typecheck`, removing the hardcoded per-package `pnpm --filter` line in `.github/workflows/ci.yml`.
- **`shell/package.json` prebuild filter** is a known maintenance trap — each new SDK-shape package requires adding a `pnpm --filter` line. Folded into the above ADR.
- **`staleSpawns.ts` maintenance trap** — daemon ID list is hardcoded; each new node requires adding it. Sprint 5+ should genericize.
- **"Current state = next milestone in active development" convention** — applied in #81 README update, should be banked as a §11 governance entry in a future small lane.
- **Voice tool migration for `time`** — #85 created the mesh node but the existing raven-internal time tool wasn't rewired. Follow-up lane in Sprint 5 should swap `raven.time` to invoke `mesh.invoke('time.now')`.
- **Retroactive version cuts** — `CHANGELOG.md`'s `[Unreleased]` has accumulated since 2026-05-12 without intermediate version tags. Cutting v0.5.0 / v0.6.0 / v0.7.0 / v0.8.0 retroactively is a separate decision out of scope for any single Wave 3 lane.

## Sprint 5+ direction shift — mesh viz + cross-surface agent creation

A vision conversation late in Sprint 4 introduced a substantial direction shift for the next 3–4 sprints. Captured here briefly; a dedicated `docs/agent-platform-roadmap.md` will be drafted in a Sprint 5 planning conversation.

Two threads:

1. **Observe** — visualize the mesh as a live system (agents, nodes, jobs, edges, in-flight invocations) as a first-class user surface, not just a developer tool. The existing Mesh Dev Tools surface becomes the seed for a richer mesh-viz app. Likely Sprint 5 work — folds into the planned "1 UI lane" in the Sprint 5 (v0.10.0 "Action surfaces") batch.

2. **Create** — make adding to the mesh seamless from voice, vision, and on-screen surfaces. Current pattern ("draft a prompt → fire CC → ship a PR" for each new node) is great for the developer building Aether; wrong shape for end users. Users should be able to say "make me a node that watches X and notifies me when Y" and the system materializes it. Multi-sprint arc.

Sharpening questions for the dedicated roadmap doc:

- Is "agent" a distinct abstraction from "node"? (Currently the project has nodes + composers + voice tools; "agent" suggests a new user-created automation layer atop nodes.)
- What's a "job"? (Scheduled? Transient invocation? Long-running composition?)
- Creation-flow shape across voice/vision/on-screen — declarative natural language, vision-identified context, no-code visual builder?
- End-user vs. developer scoping — is the primary user the Director or eventual third parties?

Sprint mapping (provisional):

- **Sprint 5 (v0.10.0 "Action surfaces")** — 1 UI lane likely becomes mesh viz upgrade.
- **Sprint 6 (v0.11.0 voice ambient + vision)** — vision-based agent creation.
- **Sprint 10** — runtime-synthesized agents / plugin architecture.

The dedicated `docs/agent-platform-roadmap.md` (style mirrors existing `docs/voice-ambient-roadmap.md` and `docs/mcp-integration-arc-roadmap.md`) will sharpen these questions, define the agent/node/job vocabulary, and stage the sprint-by-sprint breakdown. Drafted in a separate conversation as a Sprint 5 planning anchor.

## Numbers

- **PRs merged:** 13 (#64, #65, #66, #67, #69, #73, #74, #75, #77, #80, #81, #84, #85) + this retrospective = 14 total.
- **New nodes:** 4 (clipboard_history, macos_messages, macos_mail, time).
- **New surfaces on existing nodes:** 1 (`system_info.processes`).
- **New shared primitives:** 1 (`@aether/macos-applescript` bridge package).
- **Lines moved to archive:** ~2782 (`DECISIONS.md` ~1834 + `CHANGELOG.md` ~948).
- **CC stalls recovered:** 5 (3 in Wave 2, 2 in Wave 3 — all via manual completion or git-status triage).
- **Manual-completion runs:** 3 (one full node, two partial).
- **CI failures hit and fixed:** 3 (lockfile mismatch #74, missing types #75, fresh-worktree typecheck #85).
- **CHOKE files removed:** 2 (`DECISIONS.md`, `CHANGELOG.md` via #80).
- **Sprint duration:** 6 calendar days.

## What's next

Sprint 5 (v0.10.0 "Action surfaces") is the next planning anchor. Draft scope:

- The mesh-viz UI lane (per the direction shift above).
- 3–4 write-surface lanes (calendar create-event, mail send, reminders create, etc.).
- Voice tool migration for `time` (the follow-up to #85).
- Enacting the `pnpm -r build` Proposed ADR.
- Banking the "current state = next milestone" convention.
- The dedicated `docs/agent-platform-roadmap.md` planning doc.

Sprint 5 fires in a separate conversation. Sprint 4 closed at v0.9.0; next milestone v0.10.0.

---

*Drafted by Architect (Claude Opus 4.7) at the close of Sprint 4. Manual-completion lane; content reflects the Architect's perspective on Sprint 4 outcomes. Banked in `docs/governance-log.md` for cross-reference.*
