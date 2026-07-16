## [2026-07-16] A2 shadow mode — agreement record before arming as the self-merge doctrine (#392)

**Status:** accepted

**Decided by:** Director (ratified spec on #392, incorporating the Director's
2026-07-16 cap directive); implementation on `lane/issue-392`.

**Context:** The merge condition (CLAUDE.md §1) is CI green + `REVIEWER:
APPROVE` on the current head SHA + the Director's button. Granting any
machine authority over that button is the A2 rung of the autonomy ladder,
deliberately not taken (#311 kept the reviewer verdict advisory). Docs-only
lanes — retros, governance-log batches, changelog fragments, ADRs — are the
narrowest and most reversible merge class, the natural first candidate for
self-merge; but "the machine would have pressed the same button" was an
impression, not a record. Nothing measured how often a purely mechanical
evaluation of the class-1 conditions agrees with the Director's actual
merges, so an arming decision would have rested on judgment alone.

**Decision:** Shadow before arming. A checker (`scripts/a2-shadow-check.mjs`,
run by `.github/workflows/a2-shadow.yml` on every PR merged to main) scores
each merge against the class-1 self-merge conditions — ARCHITECT RATIFICATION
on the Closes-issue predating its first GATE REPORT, `REVIEWER: APPROVE`
whose Reviewed SHA equals the merged head SHA, CI green on that head, an
all-pass mechanical auto-review comment, every touched path inside the
`scripts/a2-classes.json` class-1 allowlist, no HOLD label on the issue — and
posts one verdict comment: `A2-SHADOW: AGREE (class-1)` / `OUT-OF-CLASS` /
`DISAGREE (reason)`. Three bindings:

1. **Shadow only.** The checker takes no merge action at any verdict. Its
   entire output is the agreement record.
2. **Machine-checkable conditions only; class membership by path, never
   judgment.** Class-1 is a path allowlist in `scripts/a2-classes.json`; a
   condition that needs interpretation does not belong in a self-merge class.
3. **Arming is a future, separate ADR-gated lane.** The arming condition is
   10 consecutive AGREE/OUT-OF-CLASS verdicts with zero DISAGREE on class-1
   merges (`--tally` computes the streak). Reaching the threshold arms
   nothing by itself — it makes the arming ADR *writable*, on evidence.

Post-arming shape (the Director's 2026-07-16 cap directive, banked here so
the arming lane inherits written law, per §13.13's oral-law caveat): once any
class self-merges, the flat lane cap retires — lane caps become **per-class
and resource-governed via telemetry budgets** (the #364 telemetry family is
the measurement substrate); the rebase thrash of higher merge throughput is
answered by **A3 batching** (queueing compatible class-1 merges), not by
re-tightening caps.

**Consequences:** Every merge to main accrues one advisory A2-SHADOW comment
with zero process change for the Director. A DISAGREE on a class-1 merge
resets the streak and is itself signal — either a condition is wrong, the
checker is wrong, or the merge was — and the disagreement is on the record
either way. The reviewer cell's verdict stays advisory; nothing here promotes
it to a required status check. Class-2 definition, any merge action,
auto-arming, and telemetry budget enforcement remain explicitly out of scope
until their own lanes.

**Alternatives considered:** Arm A2 directly on Director judgment (rejected:
the record must exist before the authority; judgment is what the record is
replacing). Promote `REVIEWER: APPROVE` to a required status check as a first
step (rejected: that is itself the A2 decision #311 declined, and it gates
without measuring agreement). LLM-judged class membership (rejected: class-1
must be path-checkable; judgment reintroduces exactly the fallibility the
shadow record is meant to measure). Count only AGREE toward the streak,
excluding OUT-OF-CLASS (rejected: a correct refusal is evidence the classifier
fences properly, which is part of what arming trusts).
