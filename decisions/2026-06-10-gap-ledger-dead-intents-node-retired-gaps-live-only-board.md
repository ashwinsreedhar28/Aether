## [2026-06-10] ADR: the gap ledger is dead — intents node retired, gaps live only on the board (Lane C of #255)

**Status:** accepted
**Decided by:** Architect (rulings on #255 and the #258 gate), Director-approved;
applied by Implementer in Lane C (#258). Companion to the Lane A ADR below
(the `github` node surface contract).
**Context:** With `github.create_issue` merged (Lane A, #264), the gap rail had
two write paths: raven → `intents.record` (the JSONL ledger) and the new issue
board. A consumer-less shadow store contradicts one-rail, and the intents node's
only remaining consumers were the raven gap tools and a parked visualizer
overlay.
**Decision:** (1) **Intents node FULLY RETIRED** — package, manifest entry, all
five edges, shell spawn/secret/env wiring (#255 ruling 2: a consumer-less node
contradicts one-rail). The live ledger is archived in place as
`gaps.jsonl.archived` after a one-time backfill files the open gaps through
`create_issue` (in-process handler import, no temporary edge; bodies note the
provenance; closed gaps are answered history and are not filed). (2)
**`close_gap` RETIRED with no replacement** (#255 ruling 3): gaps close through
the merge rail (`Closes #n`) or by the Director on the board; raven points at
the rail when asked. (3) **Filing is voice-gated** (#255 item 5): two-turn
confirmation ("I can't do that yet — want me to file it?"), `gaps.auto_file`
knob (config.json, default false), and a rate guard — after 5 creates in one
session every further create needs explicit confirmation regardless of the
knob. (4) **`review_gaps` repointed to `github.list_issues`** (ruling 4),
keeping the "what can't you do yet" voice affordance; a missing token surfaces
as an error, never as a false "no gaps". (5) **Visualizer gaps overlay
STRIPPED** (gate ruling): the visualizer is parked on the AVP track and gets no
new consumers; the Gaps app renders the board.
**Consequences:** One write rail and one read rail for gaps, both through the
github node; gap demand accrues as +1 comments on deduped issues; raven sessions
carry a uuid (`SessionContext.session_id`) that filed issues record; the
governance line "no Implementer starts from a gap issue until it carries an
ARCHITECT SPEC comment" lands in CLAUDE.md §1. The retired prompt sections
(close_gap, `visualize({intent:'gaps'})`) shrink the system instruction; the
prompt's remaining `visualize`/`navigate` references predate this lane and are
flagged as drift (no such registered tools since the scene-server retirement).
**Alternatives considered:** Keeping the ledger as a read-cache (rejected: two
sources of truth); a `close_issue` surface (rejected per ruling 3 — judgment
call stays human at current dial); repointing the visualizer overlay to
`github.list_issues` (rejected: parked surface, no new consumers); backfilling
through a mesh hop with a temporary edge (rejected: manifest churn for a
one-shot script).
