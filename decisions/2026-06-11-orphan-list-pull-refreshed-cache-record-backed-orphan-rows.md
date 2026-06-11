## [2026-06-11] ADR: the orphan list is a pull-refreshed cache, and record-backed orphan rows are completable (#318)

**Status:** accepted (supersedes the bare-row consequence of the #305 ADR's
alternative (c) below — the warn-and-force decision itself stands untouched)

**Decided by:** Architect (spec on #318, field — twice in one evening),
implemented on `lane/issue-318`.

**Context:** The orphan list was seeded once in `probeTmux()` at boot and
only `reattach()` ever consumed an entry, so sessions killed mid-app-life —
and sessions whose records had been force-closed — kept REATTACH rows until a
full relaunch (the field ledger shows hand-appended duplicate `closed` lines
trying to clear them). And the orphan rows themselves (the per-card strip and
the standalone ORPHANED LANES card) offered only REATTACH, so a finished lane
surfacing there could not have its record closed in place.

**Decision:** Two coupled contracts.

1. **Orphan freshness is pull-based** (the Rung 2.5 philosophy — no
   background poller): `spawn:refresh-orphans` re-probes tmux on Lanes open,
   card summon, and explicit refresh. The probe reads attachment from tmux
   itself (`#{session_attached}`), never from shell-side bookkeeping; the
   fold drops entries whose session is dead OR whose newest matching ledger
   record is terminal (closed/dismissed/failed) — a force-closed lane's
   surviving session no longer earns even a bare row, because its record's
   cleanup block owns the teardown (#317 will execute it). The boot seed is
   the first refresh, not a snapshot; a failed enumeration keeps the cache; a
   successful `complete()` drops its row synchronously.
2. **Record-backed orphan rows are completable.** `OrphanLane` carries the
   backing record's id when (and only when) that record is live; one shared
   row component behind both hosts renders a ghost COMPLETE beside REATTACH
   with the full #305/#308 warn-and-force semantics (live-session refusal →
   COMPLETE ANYWAY on that row, absent-not-disabled everywhere else).

**Consequences:** No relaunch is ever needed to converge the strips with
tmux reality; a finished, orphaned lane closes from any surface its row
appears on; hand-made `lane-*` sessions stay reattach-only (no record to
close). The in-flight recipe's own detached session is excluded from the
fold by name, so a re-probe during a spawn cannot raise a ghost row.

**Alternatives considered:** (a) A background tmux poller — rejected: the
Rung 2.5 pull-based ruling (#310) covers exactly this shape. (b) Keeping
terminal-record sessions as bare `(no ledger record)`-style rows (the #305
position) — rejected by spec: the row's only affordance (REATTACH) is noise
for a lane whose lifecycle is over. (c) Shell-side attached-session
bookkeeping (mark sessions reattached this lifetime) — rejected:
`#{session_attached}` is daemon-side truth and also catches terminals the
Director closed mid-life. (d) Wiring orphan-row COMPLETE through the parent
card's justClosed teardown raise — rejected: the strip rides on EVERY card
branch, and yanking the displayed card to another record's teardown is the
#302-defect-7 hazard class; the cleanup block stays reachable from the
closed record's own card (Lanes row summon).
