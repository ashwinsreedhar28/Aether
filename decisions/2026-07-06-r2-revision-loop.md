## [2026-07-06] ADR: The R2 revision loop — four laws for the gate's REVISING state (#339)

**Status:** accepted

**Decided by:** Architect (ratified spec v1.1 on #339, Director-ratified scope rider), implementation on `lane/issue-339`.

**Context:** Rung 2.5 gave lanes a gate (#310): a lane posts its GATE REPORT
to its issue thread and stops; the Director smoke-tests and relays the one
allowlisted sentence ("clean, proceed"). What was missing is the middle
outcome — the test FAILS and the lane should be sent back, not shipped and
not killed. The Director's requirement is conversational: report issues,
have the lane fix them, re-test. That collides with two standing security
postures: the relay allowlist (no freeform text has a code path into a live
implementer pane) and the pull-based gate fold (no poller; the card folds
the issue thread on open/REFRESH). The revision loop had to add a feedback
channel and a REVISING card state without weakening either.

**Decision:** The lane channel gains a third prefix (`DIRECTOR FEEDBACK`)
and the gate gains a REVISING state, governed by four laws:

1. **Gate phase is always a pure fold of the issue thread; the ledger
   records only Director actions.** PR OPENED → pr-opened; else a report
   with feedback strictly newer → REVISING; else a report → at-gate; else
   working (`laneGate.gatePhase`). No gate-state machine, no stored phase:
   the thread is the single source, the spawn ledger holds only the
   Director's relay/teardown acts.
2. **The feedback contract is latest-comment-only.** The Director
   consolidates each cycle into ONE comment; the lane reads only the newest
   DIRECTOR FEEDBACK — earlier feedback is history. Supersession by a fresh
   GATE REPORT is the only clearing mechanism, by design: a post-revision
   report is newer than the feedback, so latest-wins flips the card back to
   AT GATE with zero clearing logic.
3. **Freeform feedback travels the issue thread only; the pane receives
   nothing but allowlisted sentences.** The allowlist is a pane-input
   property, not a feedback property — it grows to exactly two literals
   (`clean, proceed`; `revise per the latest DIRECTOR FEEDBACK, then
   re-gate`), enforced at ledger-write time, at argv-build time, and at
   execution time. The card's REVISE posts typed feedback to the thread via
   `gh issue comment --body-file <tmpfile>` (execFile, temp-file body per
   the quoting law; gh keyring auth like the lanes' own posts), then relays
   the fixed sentence — post before relay, and a failed post relays nothing.
4. **No revision cap in code for v1.** Every revise is a human act (card
   button or confirm-gated voice), so the loop is self-limiting; the
   two-strikes doctrine applies — two failed revision rounds means the spec
   is wrong: kill the lane and respec. Code caps become a design requirement
   only when non-human revision triggers exist (rung-2+, per the autonomy
   ADR).

The scope rider also lands the #363 submodule-die fallback lines (rm -rf →
`git worktree prune` → `git branch -D`) in the card's copyable cleanup
block, mirroring the executor's recovery order.

**Consequences:** The Director can send a lane back from the card (typed
feedback + REVISE) or by voice (`lane_revise`, trigger-only) without any
freeform text approaching a pane. The kickoff dictates the loop's lane-side
half, so re-gating needs no new shell machinery — the READY-TO-TEST toast
re-fires on the post-revision report because its dedupe already keys on the
report comment's created_at. Voice-dictated feedback content is a designated
fast-follow that fills `spawn.revise(feedbackText)` through the same IPC.
The fold mirror in `lane_gate_tool.py` (whats_ready_to_test) does not yet
know the third prefix, so a REVISING lane still counts as at-gate to voice
queries — a known, harmless drift to fix when that tool next changes.

**Alternatives considered:** Relaying feedback text directly into the pane
(rejected: breaks the allowlist posture — one compromised or garbled ledger
line could type into a live implementer session); a ledger family for
feedback posts (rejected: the thread is the durable record; the revise relay
line is the ledgered Director act — a post family would be a second source
of truth); explicit clearing logic for consumed feedback (rejected:
supersession by a newer report is strictly simpler and keeps the fold pure);
accumulating multi-comment feedback (rejected for v1: consolidation into one
comment keeps the lane's contract unambiguous); a code-enforced revision cap
(rejected per law 4 — human-paced loops need human limits, not counters).
