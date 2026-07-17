## [2026-07-16] Drain proposer is propose-only — the self-staffing on-ramp (#393)

**Status:** accepted

**Decided by:** Director (ratified spec on #393); implementation on
`lane/issue-393`.

**Context:** Ratified, unclaimed lane issues sat invisible between chat
sessions — work the Director had already approved waited for the Director to
*remember* it (lane #372 sat eight days at a different rung of the same
problem before #378). The spawn machinery is human-gated by construction:
work_on_issue arms a batch, the card waits for the tap, capacity is capped at
3. Any self-staffing step risks eroding exactly that gate; the #380 incidents
established the companion law that new flows ride the existing rails rather
than growing parallel ones.

**Decision:** Aether notices, and only notices. A shell-main drainProposer
(laneMonitor's sibling) scans on boot + every 30 min + on lane close-out for
open `label:lane` issues that are unclaimed in the ledger fold, un-HELD, and
carry an ARCHITECT RATIFICATION comment, then arms at most ONE batch —
oldest-first, stopping at capacity — through the EXISTING work_on_issue
machinery: the same request-line shapes, the same card, the same
approve/dismiss, the same recipe. The Director's tap remains the only spawn
trigger; dismissing the proposal suppresses its candidates for 24h via a
kind:'drain' ledger line. Three bindings:

1. **Propose-only.** The proposer takes no spawn action at any point. Its
   entire output is a pending approval card plus a notification.
2. **The drain family is inert bookkeeping.** Drain lines follow the
   gate/telemetry posture — kind-tagged, deliberately NO `status` field — so
   every existing fold on both the TS and Python sides ignores them with
   zero raven-core edits.
3. **Auto-spawn stays flag-off behind the substrate ADR.** Approving its own
   proposals is a machine-authority rung (the A2 ladder's spawn-side twin,
   see the 2026-07-16 A2 shadow ADR): it arrives, if ever, as a separate
   ADR-gated lane under the substrate-stays-human-architected law — no flag,
   no config knob in this lane even exists to turn it on. Per-class caps
   likewise arrive with A2 arming (the Director's 2026-07-16 cap directive),
   not here: DRAIN_MAX_LANES stays the flat human cap's default.

**Consequences:** Ratified work self-announces within one tick of capacity
freeing; the backlog drains at the Director's pace with zero new approval
machinery to trust. The Director's queue never self-grows (one proposal in
flight, ever) and a dismissal is honored durably across restarts. The Python
folds' inertness rests on the no-`status` posture rather than an explicit
kind skip; adding 'drain' to the Python skip tuples and the parity fixture's
twin is deliberate follow-up work for a raven-core lane (fenced from this
one), until which the TS mixed-family fixtures carry the pin.

**Alternatives considered:** Auto-spawn behind a config flag (rejected: a
flag is an invitation — the gate erosion happens the day it ships, not the
day it flips; the substrate ADR owns that decision). Sequencing-prose parsing
so the proposer orders candidates the way the Architect would (rejected for
v0: the Director's tap IS the sequencing check; oldest-first is the only
scoring). Proposing through a new dedicated card (rejected: #380's law —
the existing batch card already carries approve/dismiss semantics, capacity
gating, and preflight; a parallel surface would fork all three). A
status-bearing drain family with values disjoint from the capacity folds'
counted set (rejected: inertness by value survives only until someone adds a
status; inertness by absent field is the posture gate/telemetry already
proved on both sides).
