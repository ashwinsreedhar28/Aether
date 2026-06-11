## [2026-06-10] ADR: lanes spawn from issues card-gated — batch = one card, recipes serialize, capped at spawn.max_lanes (#268)

**Status:** accepted
**Decided by:** Architect (spec + batch-semantics addendum + two gate rulings,
all on #268), Director-approved; applied by Implementer on `feat/spawn-lanes`.

**Context:** Rung 3 of the Architect arc. `request_spawn` (the draft path)
gates twice — spoken passphrase, then the SpawnApproval card — because a
draft is free-form content. "Work on issue N" names a specific, board-vetted
issue, and the spawn machinery (ledger → card → §13.12 recipe) already
existed with a hard concurrency=1 gate and a Terminal.app launch that died
with the app. #268 wanted: lanes by voice, several at once, surviving app
quit, tiled into the workspace.

**Decision:** (1) `work_on_issue` (alias `spawn_lane`) is CARD-GATED ONLY —
no passphrase. The utterance's specificity plus the ARCHITECT SPEC guard
(record-not-contract law; spec-less and gap issues need an explicit spoken
override) are the upstream gates; the Director's card tap is the physical
one. A deliberate, scoped loosening — not a precedent for other tools.
(2) Batch semantics are first-class: a multi-issue utterance is ONE tool
call producing ONE card that enumerates every lane; single approve spawns
all, cancel spawns none; a batch exceeding remaining capacity is refused
whole and raven asks which subset to start. (3) Concurrency: recipes
(worktree/install) SERIALIZE through the single in-flight slot; up to
`spawn.max_lanes` (default 3 — parallel CC sessions saturate per-account API
capacity, learned empirically) spawned records run LIVE concurrently;
`busy` = recipe-in-flight OR live ≥ cap; draft-kind spawns count against the
same cap. One `apply-layout` tile per approval, after the last lane lands —
reached as in-process orchestration within Electron main (the injected
renderer dispatch, the same seam viewer_desktop's own handlers use), not a
mesh hop: no trust boundary is crossed, so no manifest edge is owed.
(4) tmux owns lane processes (`lane-<issue>`, shell-under-claude so the
session survives claude's exit); app quit never kills a lane; boot
enumerates orphaned `lane-*` sessions and offers one-tap reattach; tmux
absent degrades to a plain pty with a named `brew install tmux` remedy.
(5) The cap is single-sourced from `.env.local` as `AETHER_SPAWN_MAX_LANES`
(shell approve-gate and raven's conversational capacity check read the same
value; `config.json`'s `{ "spawn": { "max_lanes": N } }` covers standalone
raven runs).

**Consequences:** The ledger gains a second request-line family
(`kind:"lane"` with issue/batch_id/branch/worktree, sanitized at fold time —
the shell side, which runs the commands, is the enforcement point) — the
fold, card, and Lanes-panel readers must discriminate on it. lane-done
tooling can find `{issue, branch, worktree, tmux session}` on the 'spawned'
event. The `lane/issue-N` branch namespace joins `feat/...` for default lane
branches (a spec's own `Branch:` line wins). `github` gains the read-only
`get_issue` surface (body + first comment page, uncached) and raven the
`github.get_issue` edge. The gap chain composes with no new machinery:
report_gap returns the issue number; "and work on it" is a work_on_issue
call against it (which then needs the spoken spec-less override — a freshly
filed gap has no spec).

**Alternatives considered:** Passphrase on work_on_issue too (rejected: the
issue number is board-vetted, and the double gate buys nothing the card
doesn't — kept on request_spawn where content is free-form). One card per
lane in a batch (rejected by addendum: N card-taps for one utterance is
exactly the friction the batch exists to remove). Parallel recipes up to the
cap (rejected: pnpm-install storms on one disk, unreadable failure
attribution; live-session parallelism is where the win is). Killing lanes on
app quit (rejected: detachment is the point — tmux owns the process).
launchd/nohup instead of tmux (rejected: no reattach story; tmux gives the
terminal back). Auto-teardown on lane completion (out of scope by spec:
lane-done stays manual).
