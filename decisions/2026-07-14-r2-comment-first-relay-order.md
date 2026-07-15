## [2026-07-14] ADR: R2 revise wire order — the feedback comment is a read-back-confirmed PRECONDITION of the relay (#380)

**Status:** accepted

**Decided by:** Architect (ratified spec on #380, task 2 + task 6),
implementation on `lane/issue-380`.

**Context:** #339's R2 revision loop shipped the card's REVISE as
post-then-relay: the DIRECTOR FEEDBACK comment posted first, but the relay
fired on gh's 0-exit alone — nothing confirmed the comment was actually
servable from the thread before the fixed sentence pointed a lane at "the
latest DIRECTOR FEEDBACK", and only the renderer's `resolveReviseAction`
guarded the empty-feedback case at all. Two field incidents (2026-07-06
lane-372, 2026-07-15 lane-384) put the revise sentence in a lane's input
buffer with ZERO feedback on the thread and no ledger line; the #380 task-1
diagnosis attributed the typing to manual tmux ops blocks outside the
executor, but the audit it forced showed the sanctioned rail's ordering was
itself trust-based: the executor typed whatever a `requested` line asked,
comment or no comment.

**Decision:** The R2 wire order is amended — the feedback comment landing on
the thread is a PRECONDITION of the relay, not a parallel effect, enforced at
two layers of the executor:

> 1. **Comment-first with read-back.** The card's REVISE posts the DIRECTOR
>    FEEDBACK comment, re-folds the thread (shell → github.get_issue, the
>    exported laneGate fold) until the posted body reads back verbatim (one
>    retry), and only then requests the relay. A failed or unconfirmed post
>    aborts by name — `comment_post_failed` / `comment_unconfirmed` — on the
>    card return AND as a requested→failed relay pair on the ledger.
> 2. **Feedback-presence guard at the executor.** `executeRelay` refuses any
>    REVISE_TEXT relay unless the re-folded thread holds a DIRECTOR FEEDBACK
>    strictly newer than the latest GATE REPORT (ledger `failed`, reason
>    `no_feedback`). Unverifiable threads refuse identically — fail closed.
>    The guard binds every entry path: card, lane_revise voice tool,
>    hand-edited ledger line.

Delivery of BOTH allowlist sentences is verified post-send (capture-pane
read-back, one Enter retry, `enter_not_registered` on failure), so `relayed`
means verified-submitted.

**Consequences:**
- The revise sentence can no longer fire against a lane whose thread carries
  no fresh feedback — the #339 contract ("the lane reads the LATEST DIRECTOR
  FEEDBACK") is now enforced where the typing happens, not requested where
  the button lives. The voice tool needs no change: its ledger line meets the
  same executor.
- The relay ledger family gains three named failure reasons
  (`comment_post_failed`, `comment_unconfirmed`, `no_feedback`) plus
  `enter_not_registered`; the card surfaces each verbatim. Refusals are
  requested→failed pairs — the same shape proceed-with-no-lane already
  writes — so observability costs no new fold semantics.
- The executor now holds a mesh dependency (github.get_issue via the
  injected invoke, the gate monitor's edge): a down mesh blocks revise
  relays by design. Clean-proceed relays never consult the guard.
- Code-side half of Addendum 4's ONE-RELAY-RAIL doctrine. The residual other
  half is operational, out of #380's code scope: gate-relay sentences must
  ride the executor — manual `tmux send-keys` ops blocks (the task-1
  culprit class) bypass every layer above and stay visible only by their
  absence from the ledger.

**Alternatives considered:**
- *Guard in the renderer only (extend `resolveReviseAction`).* Rejected: the
  July incidents prove entry paths that never transit the card; the executor
  is the one chokepoint every path shares — the same reasoning that put the
  allowlist there (#310).
- *Trust gh's 0-exit as proof the comment landed (status quo, skip
  read-back).* Rejected: the relay's contract is that the LANE can read the
  feedback; only the serving thread proves that, and the read-back rides an
  edge (github.get_issue) the shell already holds.
- *Fail open on an unverifiable thread (relay when the fold can't run).*
  Rejected: typing into a live implementer session on faith is exactly the
  failure class #380 exists to close; a refused relay is re-pressable, a
  ghost order is not.
