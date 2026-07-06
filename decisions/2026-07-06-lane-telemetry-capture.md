## [2026-07-06] ADR: Lane telemetry capture — three laws for the measurement substrate (#364)

**Status:** accepted

**Decided by:** Architect (ratified spec on #364), implementation on `lane/issue-364`.

**Context:** R2 (#339) made revisions machine events; the retro loop needs
every lane's cost and cycle count to be a ledger fact rather than a
reconstruction from chat. The spawn ledger already holds three segregated,
kind-tagged line families (relay #310, teardown #317, plus the spawn
records themselves), and teardown is the one moment the shell provably has
the lane's whole story in hand — the worktree still on disk for a diff, the
branch still existing for a merge probe, the record's spawned event for a
time anchor, and the Claude Code session transcripts surviving under
`~/.claude/projects/` keyed by the worktree cwd. What did not exist is any
capture: which model a lane ran, what it cost in tokens, how many gate
cycles it took, and whether its work merged all evaporated at closeout.

**Decision:** A fourth kind-tagged family, `telemetry` — ONE line per
closed lane, written by the teardown executor when every destruction step
has succeeded — governed by three laws:

1. **Capture facts, classify later.** The line records what is measurable
   at teardown (issue, spawn/close timestamps, wall seconds, model, token
   sums, gate-report count, revise/proceed counts, diff shortstat,
   merged-or-abandoned outcome) and nothing interpretive. Failure taxonomy,
   quality judgments, and cost attribution are the retro loop's job, run
   over the accumulated lines — never the capture path's.
2. **Analytics never blocks teardown.** Every scraper is individually
   guarded: a failure nulls its field and appends a note to the line's
   `error`, and the closeout proceeds regardless — the worst capture
   outcome is an all-null line, never a refused or failed teardown. The
   write itself is guarded the same way.
3. **Null over guess.** An unrecoverable field is null, not a plausible
   value: `effort` is null by binding (the pinned CC version's transcripts
   carry no structured effort field); a mixed-model session records a null
   model rather than a majority vote; fields whose newer-than-spawn guard
   has no anchor (a record missing its spawned event) are null rather than
   unscoped — a respawned issue reuses its worktree path, so an unscoped
   scrape could silently include a previous run.

Load-bearing bindings under those laws: the token scrape is pinned against
Claude Code 2.1.201 — project dir = cwd with every `[^a-zA-Z0-9]` replaced
by `-`, usage rides `type:'assistant'` entries at `message.usage`, and one
API response spans multiple JSONL lines sharing a `message.id`, so entries
dedupe by message id (a fixture test pins the shape; a future convention
drift surfaces as null-with-note, never as wrong numbers). The telemetry
line carries NO `status` field, so the Python tools' capacity folds (which
key lifecycle lines on a string status) ignore it with zero edits. Gate
reports come from one gh-CLI issue read at teardown under the #317
main-side-GitHub exception, counted with the laneGate fold's exact guard
semantics; revise/proceed counts read only status-`relayed` lines (a failed
or boot-swept relay drove no cycle). The ledger JSONL is the v1 read
surface (`jq`); accessors `listTelemetry()`/`findTelemetry(issue)` exist
for future surfaces, and no renderer surface ships in v1.

**Consequences:** Every closeout now leaves a durable, machine-readable
cost-and-cycle record, so the retro loop can rank lanes by token spend,
revision count, and outcome without archaeology. Teardown gains four
fallible probes (transcript scrape, issue read, diff shortstat, merged-PR
probe) but no new failure modes — by law 2 they degrade to nulls.
Terminal-mode and manual lanes closed outside the executor get no line
(backfill is a designated follow-on script), and `effort` stays null until
a CC version writes it into the transcript.

**Alternatives considered:** Capturing telemetry in the renderer via the
github node's `get_issue` edge (rejected: capture runs main-side at
teardown time, exactly where the #317 exception already probes PR state —
a renderer hop would add a liveness dependency to a path that must never
block); summing transcript usage without message-id dedupe (rejected:
observed 2.1.201 transcripts repeat one response's usage across its content
blocks — naive summing multiplies real cost several-fold); guessing effort
from settings files (rejected under law 3: ambient config is not session
metadata and can change after the fact); counting all relay requests
including failed ones (rejected: boot-swept crash leftovers would inflate
cycle counts); a request/lifecycle pair like relay/teardown (rejected: the
line is complete at write time — a single-line family keeps the fold
trivial); blocking teardown on capture failure (rejected outright by law
2: analytics must never gate operations).
