"""Gate semantics for lane_proceed (#310): the voice confirm gate, the
live-lane guard, the fixed-text relay line shape, and the capacity-count
isolation of relay lines.

Pure ledger-file tests — no mesh, no Gemini session: lane_proceed_tool is
file I/O only, so AETHER_DATA_DIR pointed at a tmp_path is the whole rig.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import raven_core.tools.lane_proceed_tool as lpt
import raven_core.tools.work_on_issue_tool as wot


def _seed_ledger(tmp_path: Path, lines: list[dict]) -> Path:
    ledger = tmp_path / "spawns" / "requests.jsonl"
    ledger.parent.mkdir(parents=True, exist_ok=True)
    ledger.write_text("".join(json.dumps(rec) + "\n" for rec in lines), encoding="utf-8")
    return ledger


def _lane_lines(issue: int, *, spawned: bool = True) -> list[dict]:
    """A lane request line (and optionally its spawned lifecycle event)."""
    lines = [
        {
            "id": f"lane-{issue}-id",
            "ts": "2026-06-11T00:00:00+00:00",
            "kind": "lane",
            "batch_id": "b1",
            "issue": issue,
            "issue_title": "t",
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
                "worktree": f"/Users/x/aether-lane-{issue}",
                "branch": f"lane/issue-{issue}",
                "tmux_session": f"lane-{issue}",
            }
        )
    return lines


def test_no_lane_record_is_a_named_error(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    res = lpt._lane_proceed(310, confirmed=False)
    assert res == {"ok": False, "error": "no lane record for issue #310"}


def test_not_live_lane_is_refused(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    _seed_ledger(tmp_path, _lane_lines(310, spawned=False))
    res = lpt._lane_proceed(310, confirmed=False)
    assert res["ok"] is False
    assert "not live" in res["error"]


def test_first_call_is_pending_never_an_append(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    ledger = _seed_ledger(tmp_path, _lane_lines(310))
    before = ledger.read_text(encoding="utf-8")
    res = lpt._lane_proceed(310, confirmed=False)
    assert res["pending"] is True
    assert "clean, proceed" in res["ask"]
    # The confirm gate wrote NOTHING — the side effect waits for the voice yes.
    assert ledger.read_text(encoding="utf-8") == before


def test_confirmed_call_appends_the_fixed_relay_line(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    ledger = _seed_ledger(tmp_path, _lane_lines(310))
    res = lpt._lane_proceed(310, confirmed=True)
    assert res == {"ok": True, "issue": 310}
    last = json.loads(ledger.read_text(encoding="utf-8").splitlines()[-1])
    # The on-disk contract the shell's foldRelays expects: kind-tagged,
    # issue-bound, the ALLOWLIST literal and nothing else.
    assert last["kind"] == "relay"
    assert last["issue"] == 310
    assert last["text"] == "clean, proceed"
    assert last["status"] == "requested"
    assert isinstance(last["id"], str) and last["id"]
    assert isinstance(last["ts"], str) and last["ts"]


def test_newest_arm_wins_over_a_dismissed_older_one(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    old = _lane_lines(310, spawned=False)
    old[0]["id"] = "old-arm"
    old.append({"id": "old-arm", "ts": "2026-06-11T00:01:00+00:00", "status": "dismissed"})
    _seed_ledger(tmp_path, old + _lane_lines(310))
    res = lpt._lane_proceed(310, confirmed=False)
    assert res["pending"] is True


def test_relay_lines_are_invisible_to_lane_status_and_capacity(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    lines = _lane_lines(310)
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
    # The pending relay neither shadows the lane's status...
    assert lpt._lane_status(310) == "spawned"
    # ...nor holds a capacity slot (#310: work_on_issue skips kind == relay).
    assert wot._committed_count() == 1


def test_gate_lines_are_invisible_to_lane_status_and_capacity(tmp_path, monkeypatch):
    """#378's mixed-family fixture pin: the monitor's gate lines (kind:'gate',
    NO status field — telemetry's posture) share the ledger but never describe
    a lane, shadow its status, or hold a capacity slot."""
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    lines = _lane_lines(310)
    lines.extend(
        [
            {
                "id": "gate-1",
                "ts": "2026-06-11T00:10:00+00:00",
                "kind": "gate",
                "issue": 310,
                "phase": "at-gate",
                "prev": "working",
            },
            {
                "id": "gate-2",
                "ts": "2026-06-11T02:10:00+00:00",
                "kind": "gate",
                "issue": 310,
                "phase": "at-gate",
                "reminder": True,
            },
            {
                "id": "tel-1",
                "ts": "2026-06-11T03:00:00+00:00",
                "kind": "telemetry",
                "issue": 310,
            },
        ]
    )
    _seed_ledger(tmp_path, lines)
    assert lpt._lane_status(310) == "spawned"
    assert wot._committed_count() == 1
