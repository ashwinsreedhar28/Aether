## [2026-06-11] ADR: the issue thread is the lane channel — gate-report prefixes and the ledger relay family (#310)

**Status:** accepted

**Decided by:** Architect (spec on #310), implemented on `lane/issue-310`.

**Context:** Lanes stopped at their gates invisibly: the gate report lived
only in the lane's tmux pane, the Director attached three panes to discover
three waiting reports, and the go-ahead ("clean, proceed") was manual pane
archaeology. Rung 2.5 needed (a) a machine-readable place lanes report to
that the card can fold, and (b) a gated relay path back into the pane.

**Decision:** Three coupled contracts.

1. **The lane's GitHub issue thread is the machine-readable lane channel.**
   The kickoff (`spawnService.laneKickoff`) dictates that the lane posts its
   full gate report as an issue comment prefixed literally `GATE REPORT — `
   before stopping at the gate, and `PR OPENED — #<pr-number> <pr-url>` the
   moment its PR opens. Consumers match on the comment-leading prefix only —
   nothing inside the report body is parsed (out of scope in v1). The prefix
   literals are duplicated in `shell/src/utils/laneGate.ts` (renderer fold)
   and pinned by tests on both sides.
2. **The card's gate state is pull-based.** A spawned lane's card runs one
   `github.get_issue` read on open plus an explicit REFRESH, over a new
   `shell → github.get_issue` edge (the #136 consumer/surface law; raven's
   edge does not cover the shell). Only comments STRICTLY NEWER than the
   record's spawned event count, so a respawn on the same issue never
   resurrects a previous run's report. No background poller in v1.
3. **The spawn ledger gains a relay line family.** Every relay line —
   request and outcome — carries `kind: "relay"` (request:
   `{ id, ts, kind, issue, text, status: "requested" }`; outcome flips to
   `relayed` or `failed` + error), so the spawn fold, the relay fold, and
   the Python capacity count all segregate the family without cross-family
   id bookkeeping. raven's `lane_proceed` (confirm-gated by voice) and the
   card's PROCEED button append the same line; the shell enforces the v1
   allowlist — the literal `clean, proceed` ONLY — and types it into the
   lane's pane via the proven pane-id send machinery. Relays found pending
   at shell boot are marked failed, never auto-sent: relays execute only
   when their request lands while the shell is live.

**Consequences:**
- Gate visibility without daemons: the board (issue thread) carries the
  report durably; the card folds it on demand; tmux attachment becomes
  optional for the relay step.
- The kickoff text is now a wire contract with two consumers (the spawned
  implementer writes it, the renderer folds it) — kickoff edits must keep
  the prefixes or bump both sides together.
- Relay lines share `requests.jsonl`; both folds (TS `fold()` /
  `foldRelays()`, Python `_committed_count` / `_lane_status`) skip the other
  family by the `kind` tag. A relay never holds lane capacity.
- Arbitrary relay text has no code path: the tool takes no text argument,
  `relaySendKeysArgs` hardcodes the literal, and the executor refuses any
  hand-edited ledger text that diverges.
- The gate check needs the github node's token and ≤100-comment threads
  (get_issue's page-1 contract) — acceptable: a thread past 100 comments has
  outgrown a voice-driven lane anyway.

**Alternatives considered:**
- Background comment poller pushing AT GATE to the card (rejected: spec
  rules out pollers in v1; pull-on-open matches Director attention).
- `gh` CLI from the Electron main process for the gate read (rejected:
  GitHub access lives in the github node; the renderer already consumes
  mesh surfaces this way — `shell → github.list_issues` precedent).
- Arbitrary relay text with an allowlist knob (rejected by spec: v1 relays
  exactly one literal; widening is a future ruling, not a default).
- Auto-executing boot-pending relays (rejected: typing into a pane minutes
  after the words were spoken is indistinguishable from auto-proceed, which
  the spec rules out).
