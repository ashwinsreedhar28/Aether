"""READY TO TEST voice tools (#340): the ledger fold for live lanes, the
Python mirror of the shell's gate fold (strictly-newer-than-spawn, latest
report wins, PR OPENED upgrades, DIRECTOR FEEDBACK newer than the report
holds REVISING — the #372 phase-parity table pins the fixtures against
laneGate.test.ts), smoke-section extraction across the heading shapes gate
reports actually use, and the spoken lines for every path — including the
named misses (no gate report, no smoke section).

The mesh hop is mocked (patch lane_gate_tool.mesh_invoke); the ledger is
real file I/O against AETHER_DATA_DIR → tmp_path — the lane_proceed-gate
test rig plus the music-tool mesh-mock pattern.
"""
import asyncio
import json
import sys
import unittest.mock as mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

# Same global mock test_tool_registry.py uses: importing raven_core.tools
# (the package __init__) pulls session_context's deep import chain.
if "raven_core.session_context" not in sys.modules:
    sys.modules["raven_core.session_context"] = mock.MagicMock()

import raven_core.tools.lane_gate_tool as lgt
from raven_core.mesh_client import MeshUnavailable


def run(coro):
    return asyncio.run(coro)


def _seed_ledger(tmp_path: Path, lines: list[dict]) -> Path:
    ledger = tmp_path / "spawns" / "requests.jsonl"
    ledger.parent.mkdir(parents=True, exist_ok=True)
    ledger.write_text("".join(json.dumps(rec) + "\n" for rec in lines), encoding="utf-8")
    return ledger


def _lane_lines(issue: int, *, spawned: bool = True, title: str = "feat(x): a thing") -> list[dict]:
    lines = [
        {
            "id": f"lane-{issue}-id",
            "ts": "2026-06-11T00:00:00+00:00",
            "kind": "lane",
            "batch_id": "b1",
            "issue": issue,
            "issue_title": title,
            "branch": f"lane/issue-{issue}",
            "worktree": f"~/aether-lane-{issue}",
            "status": "requested",
        }
    ]
    if spawned:
        lines.append(
            {
                "id": f"lane-{issue}-id",
                "ts": "2026-06-11T00:05:00+00:00",
                "status": "spawned",
                "tmux_session": f"lane-{issue}",
            }
        )
    return lines


def _comment(body: str, created_at: str) -> dict:
    return {"body": body, "created_at": created_at}


# The empty fold — the shape assertion below pins it (laneGate.test.ts pins
# the TS twin as INERT).
_INERT = {"report": None, "report_at": None, "pr": False, "feedback": None, "feedback_at": None}


def _issue_payload(number: int, title: str, comments: list[dict]) -> dict:
    return {"ok": True, "number": number, "title": title, "comments": comments}


# ------------------------------------------------------------------ contracts


def test_prefix_literals_match_the_kickoff_contract():
    # Pinned on every side of the lane channel: the kickoff template,
    # shell/src/utils/laneGate.ts, and here. A drift on any side breaks
    # the channel (#372, the #241 sibling-drift class).
    assert lgt.GATE_REPORT_PREFIX == "GATE REPORT"
    assert lgt.PR_OPENED_PREFIX == "PR OPENED"
    assert lgt.DIRECTOR_FEEDBACK_PREFIX == "DIRECTOR FEEDBACK"


# ---------------------------------------------------------------- ledger fold


def test_live_lanes_folds_only_spawned_newest_arm(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    old = _lane_lines(310, spawned=False)
    old[0]["id"] = "old-arm"
    old.append({"id": "old-arm", "ts": "2026-06-11T00:01:00+00:00", "status": "dismissed"})
    lines = old + _lane_lines(310) + _lane_lines(311, spawned=False)
    lines.append(
        {
            "id": "relay-1",
            "ts": "2026-06-11T00:10:00+00:00",
            "kind": "relay",
            "issue": 310,
            "text": "clean, proceed",
            "status": "requested",
        }
    )
    _seed_ledger(tmp_path, lines)
    live = lgt._live_lanes()
    assert [lane["issue"] for lane in live] == [310]
    assert live[0]["title"] == "feat(x): a thing"
    assert live[0]["spawned_at"] is not None


def test_live_lanes_empty_without_a_ledger(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    assert lgt._live_lanes() == []


def test_unparseable_spawned_ts_never_passes_the_gate_guard(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    lines = _lane_lines(310, spawned=False)
    lines.append({"id": "lane-310-id", "ts": "not-a-date", "status": "spawned"})
    _seed_ledger(tmp_path, lines)
    live = lgt._live_lanes()
    assert live[0]["spawned_at"] is None
    # The renderer's rule, mirrored: no parseable spawn time → no comment passes.
    gate = lgt._fold_gate([_comment("GATE REPORT — x", "2026-06-11T01:00:00+00:00")], None)
    assert gate == _INERT


# ------------------------------------------------------------------ gate fold


def test_fold_gate_mirrors_the_shell_fold():
    spawned = lgt._parse_ts("2026-06-11T00:05:00+00:00")
    comments = [
        _comment("GATE REPORT — from a previous run", "2026-06-11T00:01:00+00:00"),
        _comment("just chatting about the GATE REPORT idea", "2026-06-11T01:00:00+00:00"),
        _comment("GATE REPORT — pass 1", "2026-06-11T01:30:00+00:00"),
        _comment("GATE REPORT — pass 2 after fixup", "2026-06-11T02:00:00+00:00"),
    ]
    gate = lgt._fold_gate(comments, spawned)
    assert gate["report"] == "GATE REPORT — pass 2 after fixup"
    assert gate["report_at"] == lgt._parse_ts("2026-06-11T02:00:00+00:00")
    assert gate["pr"] is False
    # PR OPENED newer than the spawn upgrades the lane past the gate.
    comments.append(_comment("PR OPENED — #341 https://x/pull/341", "2026-06-11T03:00:00+00:00"))
    assert lgt._fold_gate(comments, spawned)["pr"] is True


# ------------------------------------------- gate phase parity (#372 mirrors #339)
#
# The fixtures below are the LITERAL bodies and timestamps of the #339 tests
# in shell/src/utils/laneGate.test.ts — the parity contract is that this
# table and that file resolve every row to the same phase. Editing either
# side alone IS the #241 sibling-drift bug this lane fixes.

_PARITY_SPAWNED = "2026-06-11T10:00:00.000Z"
_PARITY_REPORT = _comment("GATE REPORT — pass 1", "2026-06-11T11:00:00Z")
_PARITY_FEEDBACK = _comment(
    "DIRECTOR FEEDBACK — the toast fires twice, fix the dedupe", "2026-06-11T12:00:00Z"
)
_PARITY_REGATE = _comment("GATE REPORT — pass 2, dedupe fixed", "2026-06-11T13:00:00Z")
_PARITY_PR = _comment(
    "PR OPENED — #400 https://github.com/x/aether/pull/400", "2026-06-11T14:00:00Z"
)


def _phase_of(comments: list[dict]) -> str:
    return lgt._gate_phase(lgt._fold_gate(comments, lgt._parse_ts(_PARITY_SPAWNED)))


def test_gate_phase_table_mirrors_lane_gate_ts():
    # The pinned phase table — one row per laneGate.test.ts scenario.
    table = [
        ([], "working"),
        ([_PARITY_REPORT], "at-gate"),
        # Feedback strictly newer than the report → the lane owes a revision.
        ([_PARITY_REPORT, _PARITY_FEEDBACK], "revising"),
        # The post-revision report supersedes back to AT GATE — no clearing
        # logic, latest-wins alone flips the phase.
        ([_PARITY_REPORT, _PARITY_FEEDBACK, _PARITY_REGATE], "at-gate"),
        # PR OPENED outranks everything, feedback included.
        ([_PARITY_REPORT, _PARITY_FEEDBACK, _PARITY_REGATE, _PARITY_PR], "pr-opened"),
        # Preemptive feedback before any report leaves the phase at working.
        ([_PARITY_FEEDBACK], "working"),
    ]
    for comments, expected in table:
        assert _phase_of(comments) == expected, expected
    # gatePhase(null) === 'working' on the TS side.
    assert lgt._gate_phase(None) == "working"


def test_fold_carries_feedback_and_the_regate_keeps_it_verbatim():
    spawned = lgt._parse_ts(_PARITY_SPAWNED)
    revising = lgt._fold_gate([_PARITY_REPORT, _PARITY_FEEDBACK], spawned)
    assert revising["feedback"] == _PARITY_FEEDBACK["body"]
    assert revising["feedback_at"] == lgt._parse_ts(_PARITY_FEEDBACK["created_at"])
    # The stale feedback still rides the fold verbatim after the re-gate
    # (history, not contract) — only the phase flips.
    back = lgt._fold_gate([_PARITY_REPORT, _PARITY_FEEDBACK, _PARITY_REGATE], spawned)
    assert back["feedback"] == _PARITY_FEEDBACK["body"]
    assert lgt._gate_phase(back) == "at-gate"


def test_newer_than_spawn_guard_covers_director_feedback():
    spawned = lgt._parse_ts(_PARITY_SPAWNED)
    # A previous run's feedback is inert, exactly like its report.
    stale = _comment("DIRECTOR FEEDBACK — from the previous run", "2026-06-11T09:00:00Z")
    assert lgt._fold_gate([stale], spawned) == _INERT
    # The latest feedback comment wins, exactly like the report fold.
    f1 = _comment("DIRECTOR FEEDBACK — first round", "2026-06-11T11:00:00Z")
    f2 = _comment("DIRECTOR FEEDBACK — consolidated round two", "2026-06-11T12:00:00Z")
    assert lgt._fold_gate([f1, f2], spawned)["feedback"] == f2["body"]


# --------------------------------------------------------- whats_ready_to_test


def test_no_live_lanes_is_a_plain_spoken_line(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    res = run(lgt._whats_ready_to_test())
    assert res["ok"] is True and res["count"] == 0
    assert res["spoken"] == "No lanes are live right now, sir."


def test_at_gate_lane_is_named_with_a_cleaned_title(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    _seed_ledger(tmp_path, _lane_lines(334))
    payload = _issue_payload(
        334,
        "feat(music): playlists, recently-played, and app controls",
        [_comment("GATE REPORT — done", "2026-06-11T01:00:00+00:00")],
    )
    with mock.patch.object(lgt, "mesh_invoke", mock.AsyncMock(return_value=payload)):
        res = run(lgt._whats_ready_to_test())
    assert res["count"] == 1
    assert res["lanes"] == [
        {"issue": 334, "title": "feat(music): playlists, recently-played, and app controls"}
    ]
    # The spec's spoken shape: number + title, the commit-prefix dropped.
    assert res["spoken"] == "Lane 334 is ready, sir: playlists, recently-played, and app controls."


def test_working_and_pr_opened_lanes_are_not_ready(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    _seed_ledger(tmp_path, _lane_lines(310) + _lane_lines(311))

    async def fake_invoke(target, payload):
        if payload["number"] == 310:
            return _issue_payload(310, "feat(a): working lane", [])
        return _issue_payload(
            311,
            "feat(b): shipped lane",
            [
                _comment("GATE REPORT — done", "2026-06-11T01:00:00+00:00"),
                _comment("PR OPENED — #341 https://x/pull/341", "2026-06-11T02:00:00+00:00"),
            ],
        )

    with mock.patch.object(lgt, "mesh_invoke", fake_invoke):
        res = run(lgt._whats_ready_to_test())
    assert res["count"] == 0
    assert res["spoken"] == "Nothing's at the gate yet, sir — 2 lanes still working."


def test_revising_lane_is_not_ready_until_it_regates(tmp_path, monkeypatch):
    # The #372 AC: DIRECTOR FEEDBACK newer than the report holds the lane
    # REVISING — voice must not announce it as ready to test.
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    _seed_ledger(tmp_path, _lane_lines(372))
    comments = [
        _comment("GATE REPORT — pass 1", "2026-06-11T01:00:00+00:00"),
        _comment("DIRECTOR FEEDBACK — the fold misses the third prefix", "2026-06-11T02:00:00+00:00"),
    ]
    payload = _issue_payload(372, "fix(raven): gate fold parity", comments)
    with mock.patch.object(lgt, "mesh_invoke", mock.AsyncMock(return_value=payload)):
        res = run(lgt._whats_ready_to_test())
    assert res["count"] == 0
    assert res["lanes"] == []
    assert res["spoken"] == "Nothing's at the gate yet, sir — 1 lane still working."
    # The post-revision report supersedes the feedback: ready again.
    comments.append(_comment("GATE REPORT — pass 2, prefix folded", "2026-06-11T03:00:00+00:00"))
    with mock.patch.object(lgt, "mesh_invoke", mock.AsyncMock(return_value=payload)):
        res = run(lgt._whats_ready_to_test())
    assert res["count"] == 1
    assert res["lanes"] == [{"issue": 372, "title": "fix(raven): gate fold parity"}]


def test_mesh_down_is_one_friendly_deny(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    _seed_ledger(tmp_path, _lane_lines(310))
    boom = mock.AsyncMock(side_effect=MeshUnavailable("mesh error: github_no_token", reason="github_no_token"))
    with mock.patch.object(lgt, "mesh_invoke", boom):
        res = run(lgt._whats_ready_to_test())
    assert res["error"] == "github_no_token"
    assert res["spoken"] == "The board isn't configured, sir — no GitHub token."


# ------------------------------------------------------------- read_test_steps

REPORT_HEADING = """GATE REPORT — #334 feat(music): things

Lane complete.

## Verify suite (all green)

- build clean

## Director smoke (needs live mesh; not runnable from this lane)

1. "play my playlist" → starts, named.
2. Music app: pause pauses,
   toggle flips.
3. "play my flerbnerb playlist" → spoken no-match line.

## Notes / risks

- none
"""


def _steps_for(report_body: str, number: int = 334):
    payload = _issue_payload(number, "feat(x): t", [_comment(report_body, "2026-06-11T01:00:00+00:00")])
    with mock.patch.object(lgt, "mesh_invoke", mock.AsyncMock(return_value=payload)):
        return run(lgt._read_test_steps(number))


def test_numbered_walkthrough_with_continuation_lines():
    res = _steps_for(REPORT_HEADING)
    assert res["ok"] is True
    assert res["steps"] == [
        '"play my playlist" → starts, named.',
        "Music app: pause pauses, toggle flips.",
        '"play my flerbnerb playlist" → spoken no-match line.',
    ]
    assert res["spoken"].startswith("Lane 334's smoke walkthrough, sir — 3 steps. Step 1:")
    assert "Step 3:" in res["spoken"]


def test_smoke_heading_shapes_all_extract():
    for opener in ("## SMOKE", "## SMOKE (Director)", "**Director smoke**", "SMOKE (Director):"):
        body = f"GATE REPORT — x\n\n{opener}\n\n1. step one\n2. step two\n\n## Next\n\n- other"
        res = _steps_for(body)
        assert res["ok"] is True, opener
        assert res["steps"] == ["step one", "step two"], opener


def test_prose_smoke_section_is_spoken_whole():
    body = "GATE REPORT — x\n\n## SMOKE\n\nOpen the app and `verify` the **card** renders.\n"
    res = _steps_for(body)
    assert res["steps"] == ["Open the app and verify the card renders."]
    assert res["spoken"] == "Lane 334's smoke check, sir: Open the app and verify the card renders."


def test_latest_gate_report_wins_no_spawn_guard():
    payload = _issue_payload(
        334,
        "feat(x): t",
        [
            _comment("GATE REPORT — old\n\n## SMOKE\n\n1. stale step", "2026-06-11T01:00:00+00:00"),
            _comment("GATE REPORT — new\n\n## SMOKE\n\n1. fresh step", "2026-06-11T02:00:00+00:00"),
        ],
    )
    with mock.patch.object(lgt, "mesh_invoke", mock.AsyncMock(return_value=payload)):
        res = run(lgt._read_test_steps(334))
    assert res["steps"] == ["fresh step"]


def test_no_gate_report_is_the_named_miss():
    payload = _issue_payload(336, "feat(y): t", [_comment("just chat", "2026-06-11T01:00:00+00:00")])
    with mock.patch.object(lgt, "mesh_invoke", mock.AsyncMock(return_value=payload)):
        res = run(lgt._read_test_steps(336))
    assert res["ok"] is False and res["error"] == "no_gate_report"
    assert res["spoken"] == "No gate report on issue 336 yet, sir — that lane hasn't reached its gate."


def test_report_without_smoke_section_is_named_too():
    res = _steps_for("GATE REPORT — x\n\n## Verify suite\n\n- build clean\n")
    assert res["ok"] is False and res["error"] == "no_smoke_section"
    assert res["spoken"] == "Lane 334's gate report carries no smoke section, sir."


def test_bad_number_and_mesh_deny_paths():
    res = run(lgt._read_test_steps("not a number"))
    assert res["ok"] is False
    assert res["spoken"] == "Which lane, sir? I need its issue number."
    boom = mock.AsyncMock(side_effect=MeshUnavailable("mesh error: github_not_found", reason="github_not_found"))
    with mock.patch.object(lgt, "mesh_invoke", boom):
        res = run(lgt._read_test_steps(999))
    assert res["error"] == "github_not_found"
    assert res["spoken"] == "There's no issue by that number on the board, sir."


# -------------------------------------------------------------------- dispatch


def test_handle_call_async_routes_both_tools_and_ignores_others(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    assert run(lgt.handle_call_async("whats_ready_to_test", {}))["ok"] is True
    res = run(lgt.handle_call_async("read_test_steps", {"number": None}))
    assert res["ok"] is False
    assert run(lgt.handle_call_async("play_music", {})) is None
