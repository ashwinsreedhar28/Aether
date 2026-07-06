### Added
- The R2 revision loop (#339): a gated lane can now be sent back instead of
  shipped or killed. The lane channel gains a third prefix — the card's
  REVISE posts typed feedback to the lane's issue thread as a `DIRECTOR
  FEEDBACK — …` comment (main-process `gh issue comment --body-file`
  helper: execFile, temp-file body, gh keyring auth; a failed post relays
  nothing), then relays the SECOND allowlisted sentence, `revise per the
  latest DIRECTOR FEEDBACK, then re-gate`, into the lane's pane. Feedback
  strictly newer than the report folds the card to **LANE REVISING** with
  the feedback inline (PROCEED stays as the accept-anyway override); the
  post-revision GATE REPORT flips it back to AT GATE by pure supersession
  and re-fires the ready-to-test toast (dedupe keys on the report comment's
  created_at). A `lane_revise` voice tool ("revise lane 339") relays the
  same fixed order, confirm-gated, trigger-only — feedback content never
  crosses the relay, on the card or by voice. The kickoff now dictates the
  loop's lane-side half (read the newest DIRECTOR FEEDBACK, address it,
  re-gate; earlier feedback is history). Rider from PR #365: the copyable
  cleanup block carries the #363 submodule-die fallback lines (rm -rf →
  `git worktree prune` → `git branch -D`).
