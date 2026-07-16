"""The July-14 duplicate-request ledger shape (#383) — the parity fixture.

One mixed-family table, pinned LITERALLY on both sides of the fold: this
module is the Python copy; shell/electron/main/services/spawnLedger.test.ts
carries the TS twin (same ids, timestamps, statuses — laneMonitor.test.ts
seeds the lane-family subset). Editing either side alone is the #241
sibling-drift bug. The parity contract both sides must resolve identically:

  - lane 371: one record, spawned          → LIVE
  - lane 374: an older record that SPAWNED and a newer record that failed
    preflight and was dismissed (the second voice arm, 32s after the first)
                                            → LIVE via the OLDER record
  - relay / teardown / gate / telemetry lines interleaved → all inert to
    the lane fold (family segregation)
  - liveness law: status FIRST, newest among the live — a dead newer
    duplicate never masks the live lane beside it
  - after CLOSED_374_TAIL (the live record closes): 374 folds out; the
    per-issue status fallback is the NEWEST record's status ('dismissed')

Timestamps are the incident's own (2026-07-14T23:44–00:28Z), second
precision.
"""

DUPLICATE_LANE_LINES: list[dict] = [
    {
        "id": "arm-371",
        "ts": "2026-07-14T23:44:10+00:00",
        "kind": "lane",
        "batch_id": "batch-371",
        "issue": 371,
        "issue_title": "fix(sdk): deny payload spread order",
        "branch": "lane/issue-371",
        "worktree": "~/aether-lane-371",
        "status": "requested",
    },
    {
        "id": "arm-371",
        "ts": "2026-07-14T23:46:24+00:00",
        "status": "spawned",
        "worktree": "/Users/x/aether-lane-371",
        "branch": "lane/issue-371",
        "tmux_session": "lane-371",
    },
    {
        "id": "arm-374-a",
        "ts": "2026-07-14T23:46:52+00:00",
        "kind": "lane",
        "batch_id": "batch-374-a",
        "issue": 374,
        "issue_title": "chore(docs): §10 gotchas",
        "branch": "lane/issue-374",
        "worktree": "~/aether-lane-374",
        "status": "requested",
    },
    {
        "id": "arm-374-b",
        "ts": "2026-07-14T23:47:24+00:00",
        "kind": "lane",
        "batch_id": "batch-374-b",
        "issue": 374,
        "issue_title": "chore(docs): §10 gotchas",
        "branch": "lane/issue-374",
        "worktree": "~/aether-lane-374",
        "status": "requested",
    },
    {
        "id": "arm-374-a",
        "ts": "2026-07-14T23:49:19+00:00",
        "status": "spawned",
        "worktree": "/Users/x/aether-lane-374",
        "branch": "lane/issue-374",
        "tmux_session": "lane-374",
    },
    {
        "id": "arm-374-b",
        "ts": "2026-07-14T23:56:15+00:00",
        "status": "failed",
        "step": "preflight",
        "error": "worktree path already exists: /Users/x/aether-lane-374",
    },
    {"id": "arm-374-b", "ts": "2026-07-14T23:56:17+00:00", "status": "dismissed"},
    {
        "id": "relay-374",
        "ts": "2026-07-14T23:56:28+00:00",
        "kind": "relay",
        "issue": 374,
        "text": "revise per the latest DIRECTOR FEEDBACK, then re-gate",
        "status": "requested",
    },
    {"id": "relay-374", "ts": "2026-07-14T23:56:29+00:00", "kind": "relay", "status": "relayed"},
    {
        "id": "gate-374",
        "ts": "2026-07-15T00:10:00+00:00",
        "kind": "gate",
        "issue": 374,
        "phase": "at-gate",
        "prev": "working",
    },
    {"id": "td-372", "ts": "2026-07-15T00:11:00+00:00", "kind": "teardown", "issue": 372, "status": "requested"},
    {"id": "tel-372", "ts": "2026-07-15T00:12:00+00:00", "kind": "telemetry", "issue": 372},
]

# Appended after the incident window: the live 374 record closes out. With
# no live record left, per-issue resolution falls back to the NEWEST record
# — arm-374-b, 'dismissed'.
CLOSED_374_TAIL: list[dict] = [
    {"id": "arm-374-a", "ts": "2026-07-15T00:28:09+00:00", "status": "closed"},
]
