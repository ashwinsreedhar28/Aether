## [2026-06-10] ADR: gaps are GitHub issues — the `github` node surface contract (Lane A of #255)

**Status:** accepted
**Decided by:** Architect (rulings comment on #255, 2026-06-10), Director-approved
split; applied by Implementer in Lane A (#256). The companion decision — full
retirement of the `intents` gap ledger — lands with Lane C (#258), not here.
**Context:** The gap ledger (`nodes/intents`, fsync'd JSONL) was the last shadow
work-queue: gaps lived in a private store while all other work lived on the
GitHub issue board. #255 kills the split — one rail: notice → issue → spec →
lane → PR → merge. Lane A builds the substrate: a `github` Actor node whose
surface contract Lanes B (panel, #257) and C (raven flow + backfill, #258)
build against, so its load-bearing choices needed binding before B/C spawn.
**Decision:** (1) **Dedup lives inside `github.create_issue`** — the node
searches open `gap`-labeled issues by normalized capability key (a
machine-readable `<!-- aether:gap-key:… -->` body marker) and comments the
existing issue instead of filing a duplicate, returning `{ deduped: true,
number }`. The surface is the single enforcement point; every writer (raven,
backfill, future agents) gets dedup for free. The node also memoizes its own
writes in-process and re-verifies memo hits open via a direct by-number read:
GitHub's filtered list endpoint is eventually consistent (observed live in
the #256 smoke — a just-filed issue missed the next scan), and back-to-back
re-asks must still dedup. (2) **Repo is config, never
constant** — `AETHER_GITHUB_REPO` (default `ashwinsreedhar28/Aether`),
deliberately the multi-repo seed; auth via `AETHER_GITHUB_TOKEN`, fine-grained
PAT, Issues RW only, never logged. (3) **Token absent = clean degraded mode** —
`list_issues` serves `{ issues: [], token_available: false }`, writes deny
with `github_no_token`, nothing crashes. (4) **No `close_issue` surface** —
gaps close through the merge rail (`Closes #n`); non-PR closes are Director
board actions; revisit only if demand appears. (5) **Gap issues are RECORDS,
not contracts** — verbatim utterance, failure path, session id, timestamp; no
spec content; work starts only when an ARCHITECT SPEC comment lands.
**Consequences:** Lane B is pure renderer work over `shell →
github.list_issues`; Lane C repoints `report_gap`/`review_gaps` and retires
`close_gap` + the intents node against this contract. Both env vars are
recorded for #223's env-contract blessing. Gap issues accumulate demand signal
(comment count) by design. The dedup scan reads one API page (100 open gaps) —
beyond that, oldest gaps stop deduping; accepted.
**Alternatives considered:** (a) Dedup in raven (the caller) — rejected: two
future writers means two dedup implementations and a race window; the surface
is the rail. (b) `gh` CLI instead of REST + PAT — rejected: gh's auth state is
host-dependent and invisible to the mesh; a PAT in env is deterministic and
scopeable to Issues RW. (c) Hardcoded target repo — rejected: forecloses the
multi-repo future for zero savings. (d) A `close_issue` surface now — rejected:
closing is a judgment call that stays human at the current autonomy dial.
