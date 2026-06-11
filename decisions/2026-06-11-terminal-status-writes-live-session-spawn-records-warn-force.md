## [2026-06-11] ADR: terminal status writes on live-session spawn records are warn-and-force, never silent (#305, narrows #304)

**Status:** accepted

**Decided by:** Architect (spec + state-gated-actions addendum on #305, field
addendum on #304), implemented on `lane/issue-305`.

**Context:** The lane-232 incident: a spawn record whose tmux session was
still alive was closed, which discounted live capacity and left the surviving
session unmatched by the next boot's orphan seed — filed as an orphan-matcher
defect (#304). The #305 audit found the matcher's spawned-only filter behaved
per contract; `dismiss()` has refused non-`requested`/`failed` records since
the spawn actor landed (#192). The actual hole was `complete()`, which
appended `closed` to any spawned record unconditionally — a silent terminal
write on a live session.

**Decision:** A terminal status write on a spawned record whose tmux session
is alive must be **explicit, never silent**. `complete()` probes the recorded
session (when tmux is probeable) and refuses with `code: 'live-session'`
unless called with `force`; the card surfaces the warning and re-offers the
same action as COMPLETE ANYWAY, and the post-close cleanup block now leads
with `tmux kill-session -t '=lane-N'` so the teardown the Director copies
also kills the surviving session. `dismiss()` stays hard-blocked on spawned
records (stronger than the spec's "blocked or non-terminal" floor — kept).
Companion law (the #305 addendum): a card's action set is a function of
record state, and illegal actions are **absent, not disabled** — requested
shows Approve + Dismiss only (the over-cap MARK COMPLETE shortcut, which
acted on a *different* live record from the requested card, is removed);
in-flight/queued show progress only; spawned shows Reattach-primary (when
orphaned) + the gated Mark-complete; failed/closed/dismissed keep only their
remove-from-view affordance.

**Consequences:** Capacity can no longer be freed by accident while a session
runs; a force-close is a deliberate, warned act whose cleanup includes the
session kill. #304 narrows to (at most) a secondary enrichment — orphan rows
matching `closed` records — which is **declined for now**: the boot-time
matcher's spawned-only filter stays the contract, and a force-closed lane's
surviving session appears as a bare `(no ledger record)` orphan row, which is
accurate. Approve-blocking stays a *disabled-with-reason* Approve on the
requested card (the #300 visibility ruling: busy gates the button, never the
card) — "absent, not disabled" applies to actions that are illegal for the
*record's own state*, not to capacity gates.

**Alternatives considered:** (a) Hard-block complete until the session is
dead — rejected: lane tmux sessions outlive their Claude Code process by
design (the shell survives for post-mortem), so the block would force a
kill-session *before* freeing capacity, inverting the documented flow. (b)
Auto-kill the session on complete — rejected: the no-auto-run law for
teardown (cleanup blocks are copyable, never executed by the shell). (c)
Match orphan rows against closed records (#304's original ask) — declined as
above. (d) Renderer-only confirm dialog — rejected: the invariant is
lifecycle truth, so it lives in the service where every caller (IPC today,
future voice/mesh) inherits it.
