## [2026-06-17] ADR: finance.chart fetches live upstream OHLC for the detail page — the "no upstream historical fetch" posture is scoped to the history series, not the node (#354)

**Status:** accepted

**Decided by:** Implementer on `lane/issue-354`, executing the #354 ARCHITECT
SPEC (which requires "a working 1D/5D/1M/3M/1Y chart" on the detail page).
Flagged for Architect ratification at the gate.

**Context:** The finance node's `history` surface is backed by *passive
accumulation* — every poll appends one sample, pruned to a 90-day rolling
window, with no upstream historical fetch and no training-data backfill. That
posture is recorded in `nodes/finance/README.md` ("Historical backfill: No
upstream historical fetch…") and the README's `DECISIONS.md "Finance
historical quotes via passive accumulation"` pointer; it predates the #222
ADR-per-file split and so has no `decisions/` file of its own to supersede.
The #354 spec directs the detail page to chart **1D / 5D / 1M / 3M / 1Y** and
states this rides "the existing `finance.history { symbol, period }` surface
(already supports periods)." That belief is factually off in two ways: (a)
`history`'s period enum is `1d/1w/1m/all`, not the spec's spans; (b) passive
accumulation can never satisfy `1Y`/`3M` — the data only exists from node
start, capped at 90 days, so a fresh install charts nothing and `1Y` is a
fiction. The spec's *acceptance criterion* ("a working 1D/5D/1M/3M/1Y chart")
therefore cannot be met by `history` as built.

**Decision:** Add a **new** `finance.chart { symbol, range }` surface that
fetches live OHLC on demand from Yahoo's chart endpoint (via
`yahoo-finance2`'s `chart()`, already a node dependency) — intraday intervals
for `1D`/`5D`, daily bars for `1M`/`3M`/`1Y` — cached briefly per
`(symbol, range)` and never persisted. `finance.history` is **unchanged**: it
remains the passively-accumulated series backing the in-card sparkline and the
voice trend summary. The "no upstream historical fetch" posture is hereby
scoped to the **`history` series**, not the node as a whole: `chart` is the
deliberate, honest exception (its bars carry real upstream timestamps; nothing
is backfilled into `history`).

**Consequences:**
- The detail page's multi-span chart works on a fresh install and over spans
  longer than the 90-day retention window — the only way to meet the spec's
  acceptance criterion.
- The node now makes outbound upstream calls on a *consumer-driven* surface
  (`chart`), not only on its own poll cadence. The short per-`(symbol,range)`
  cache (2 min) bounds repeat hits from span-toggling / multiple viewers; the
  catalog tracked-list guard still applies, so arbitrary symbols can't burn
  fetches.
- Prose written under the old posture (the README "future PR" line for the
  detail view, the `finance_history` voice-tool docstring's "there is no
  upstream historical fetch") stays accurate *for `history`*; the README is
  updated in this PR to record `chart` as the scoped exception. The
  append-only law is not triggered — there was no `decisions/` file for the
  passive-accumulation posture to flip; this ADR is the first written record
  of the boundary.
- Future "historical" needs (e.g. a longer voice readback) now have two
  honest options to choose between explicitly: replay `history` (what we
  actually observed) vs. fetch `chart` (upstream truth).

**Alternatives considered:**
- **Map the spans onto `history`'s passive series** (rejected: cannot satisfy
  `1Y`/`3M`, and a fresh install charts nothing — fails the acceptance
  criterion and ships a chart that lies about its span).
- **Extend `finance.history` in place to fetch upstream** (rejected: collapses
  two genuinely different questions — "what did we observe" vs. "what is the
  upstream series" — onto one surface, and would silently change the contract
  every existing `history` consumer relies on, including the sparkline and the
  `finance_history` voice summary).
- **Backfill `history.db` from the upstream chart endpoint** (rejected:
  directly reverses the passive-accumulation honesty posture by persisting
  data we didn't observe; `chart`'s non-persisted, real-timestamp fetch keeps
  that honesty intact).
- **Defer the detail chart to a later lane** (rejected: the spec makes the
  working multi-span chart an acceptance criterion of *this* lane).
