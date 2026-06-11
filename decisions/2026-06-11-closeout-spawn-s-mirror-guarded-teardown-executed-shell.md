## [2026-06-11] ADR: closeout is the spawn's mirror — guarded teardown executed by the shell, confirm-gated, capacity freed only by closed (#317)

**Status:** accepted — supersedes the copy-only cleanup clause (item 3) of
"the draft is the slug contract" (2026-06-07): cleanup blocks are no longer
*never* executed by the shell; guarded, confirm-gated execution is now the
primary path, with the copyable block kept as the manual escape hatch.

**Decided by:** Architect (spec on #317; Director requested spawn/closeout
parity), implemented on `lane/issue-317`.

**Context:** Spawning a lane is one utterance + one card (#268); closing a
finished one was manual archaeology — two-beat card COMPLETE, copy the
cleanup block, run six commands in a terminal. The copy-only posture
(2026-06-07, item 3: "destroying a worktree is the Director's keystroke") was
the right v1.1 caution, but it predates the guards that now exist: the ledger
records the exact worktree/branch/session, the pane-id machinery can probe a
lane's foreground command (#300), and the warn-and-force law (#305/#308)
established how a destructive write on questionable state must be offered.

**Decision:** A `kind:"teardown"` request family joins the spawn ledger —
written by raven's confirm-gated `close_lane` tool ("close out lane N" →
spoken ask → confirmed second call) or the card's CLOSE OUT button (two-beat
confirm), one line shape, one audit trail. The shell's SpawnService executes
it behind three guards, in order: (1) an open PR on the record's branch
refuses with code `pr-open` — no force path, merge or close the PR first;
(2) a pane that has left the bare shell (`pane_current_command` probe)
refuses with code `lane-busy` — no force path (hard refusals run before the
warn so a force can never land on a subsequent refusal); (3) a dirty worktree
(`git status --porcelain`, the recipe's own untracked `.lane-kickoff.md`
excluded) or a branch with commits on no remote draws the warn, and only the
card's explicit CLOSE ANYWAY (`force`, card-only — the voice tool cannot
write it) proceeds. Execution is the canonical cleanup block's exact order,
each step precondition-guarded for retry idempotency. The spawn record gets
`closed` ONLY after every step succeeds; a failed step writes
`teardown_failed` naming it, and `teardown_failed` keeps holding its
capacity slot (both the shell's `liveCount` and the Python tools'
`_committed_count` treat it as live) — capacity is freed only by `closed`.
Boot-pending teardowns are failed by name, never auto-executed (the relay
family's no-auto-send posture). All guard probes fail closed: unverifiable
PR/pane/tree state refuses rather than destroys.

**Consequences:** The ledger gains a third kind-tagged family — every fold
(TS `fold()`, Python `_committed_count` / `_lane_status`) must skip foreign
kinds by tag, and `SpawnStatus` gains `teardown_failed` (a new card state
offering retry + the copyable block). The PR-open guard probes `gh pr list
--head` from the Electron main process via the login shell — a deliberate,
scoped exception to #310's "GitHub access lives in the github node" posture,
taken because the github node has no PR-by-head-branch surface and the guard
must run main-side at execution time; if a second main-side GitHub need
appears, that surface should be built and this probe migrated. The copyable
cleanup block remains on the closed/teardown-failed cards as the manual path
(shape-4 hand-edit lanes still exist).

**Alternatives considered:** Keeping copy-only and merely pre-filling a
terminal (rejected: Director-requested parity — spawn is one utterance, so is
closeout). Auto-closeout on PR merge (out of scope by spec: closeout stays
human-initiated). A `force` argument on the voice tool (rejected: the #308
law puts the explicit force on the card, where the warning is visible).
Probing PR state via the issue thread's PR-OPENED comment + issue open/closed
state (rejected: heuristic — a PR closed without merge leaves the issue open
forever; `gh pr list --head` is the factual, branch-keyed check the spec
names). A github-node PR surface + mesh hop for the guard (deferred, not
rejected: correct per #310's posture but a node-surface + manifest + schema
expansion the spec didn't scope; the probe is isolated in one method for that
migration).
