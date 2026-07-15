### Fixed
- R2 revise relay hardening (#380 — the July-6/July-15 ghost-sentence
  incidents): the relay executor now enforces the feedback contract and
  verifies delivery instead of trusting its callers. (1) Comment-first wire
  order — the card's REVISE posts the DIRECTOR FEEDBACK comment, confirms it
  on the thread by read-back (one retry), and only then requests the relay; a
  failed or unconfirmed post aborts by name (`comment_post_failed` /
  `comment_unconfirmed`), surfaced on the card AND as a requested→failed
  relay pair on the ledger — never silently. (2) Feedback-presence guard at
  the EXECUTOR, not just the card UI: before typing, `executeRelay` re-folds
  the lane's issue thread with the exported laneGate fold (import, never
  duplicate) and refuses any REVISE relay unless a DIRECTOR FEEDBACK strictly
  newer than the latest GATE REPORT exists — ledger `failed`, reason
  `no_feedback`; an unverifiable thread (mesh down, no invoke wired) refuses
  the same way, fail-closed. Every entry path (card, lane_revise voice tool,
  hand-edited ledger line) meets the guard. (3) Delivery verification, both
  allowlist sentences: after send-keys, a capture-pane read-back checks the
  sentence is not sitting unsubmitted on the pane's input line; one Enter
  retry; still unsubmitted → ledger `failed`, reason `enter_not_registered`
  — `relayed` now means verified-submitted, never fire-and-forget. Task-1
  diagnosis (findings on the #380 thread) exonerated both sanctioned rails
  and attributed the incidents to manual tmux ops blocks outside the
  executor; the guard + verification are the code-side half of the one-relay-
  rail doctrine (ADR 2026-07-14). Closes #380.
