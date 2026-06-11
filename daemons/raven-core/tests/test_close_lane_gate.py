"""Gate semantics for close_lane (#317): the voice confirm gate, the
closeable-state guard, the fixed teardown line shape (no force from voice),
and the capacity-count isolation of teardown lines.

Pure ledger-file tests — no mesh, no Gemini session: close_lane_tool is
file I/O only, so AETHER_DATA_DIR pointed at a tmp_path is the whole rig.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import raven_core.tools.close_lane_tool as clt
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
    res = clt._close_lane(317, confirmed=False)
    assert res == {"ok": False, "error": "no lane record for issue #317"}


def test_requested_lane_is_refused_toward_dismiss(tmp_path, monkeypatch):
    """Out of scope by spec: dismiss covers requested-state records."""
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    _seed_ledger(tmp_path, _lane_lines(317, spawned=False))
    res = clt._close_lane(317, confirmed=False)
    assert res["ok"] is False
    assert "dismiss" in res["error"]


def test_closed_lane_is_already_closed(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    lines = _lane_lines(317)
    lines.append({"id": "lane-317-id", "ts": "2026-06-11T01:00:00+00:00", "status": "closed"})
    _seed_ledger(tmp_path, lines)
    res = clt._close_lane(317, confirmed=False)
    assert res["ok"] is False
    assert "already closed" in res["error"]


def test_first_call_is_pending_never_an_append(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    ledger = _seed_ledger(tmp_path, _lane_lines(317))
    before = ledger.read_text(encoding="utf-8")
    res = clt._close_lane(317, confirmed=False)
    assert res["pending"] is True
    assert "deleted" in res["ask"]
    # The confirm gate wrote NOTHING — the destruction waits for the voice yes.
    assert ledger.read_text(encoding="utf-8") == before


def test_confirmed_call_appends_the_fixed_teardown_line(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    ledger = _seed_ledger(tmp_path, _lane_lines(317))
    res = clt._close_lane(317, confirmed=True)
    assert res == {"ok": True, "issue": 317}
    last = json.loads(ledger.read_text(encoding="utf-8").splitlines()[-1])
    # The on-disk contract the shell's foldTeardowns expects: kind-tagged,
    # issue-bound, requested — and NO force key (force is card-only, #308).
    assert last["kind"] == "teardown"
    assert last["issue"] == 317
    assert last["status"] == "requested"
    assert "force" not in last
    assert isinstance(last["id"], str) and last["id"]
    assert isinstance(last["ts"], str) and last["ts"]


def test_teardown_failed_lane_is_closeable_again(tmp_path, monkeypatch):
    """The retry path: a failed teardown's record still holds capacity and
    must be closeable by voice again."""
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    lines = _lane_lines(317)
    lines.append(
        {
            "id": "lane-317-id",
            "ts": "2026-06-11T01:00:00+00:00",
            "status": "teardown_failed",
            "step": "git worktree remove",
            "error": "boom",
        }
    )
    _seed_ledger(tmp_path, lines)
    res = clt._close_lane(317, confirmed=False)
    assert res["pending"] is True


def test_teardown_lines_are_invisible_to_lane_status_and_capacity(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    lines = _lane_lines(317)
    lines.append(
        {
            "id": "td-1",
            "ts": "2026-06-11T00:10:00+00:00",
            "kind": "teardown",
            "issue": 317,
            "status": "requested",
        }
    )
    _seed_ledger(tmp_path, lines)
    # The pending teardown neither shadows the lane's status (all three
    # folds: close_lane's own, lane_proceed's, work_on_issue's count)...
    assert clt._lane_status(317) == "spawned"
    assert lpt._lane_status(317) == "spawned"
    # ...nor holds a capacity slot.
    assert wot._committed_count() == 1


def test_teardown_failed_still_holds_capacity(tmp_path, monkeypatch):
    """#317: capacity is freed only by 'closed' — a failed teardown's record
    keeps counting against spawn.max_lanes."""
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    lines = _lane_lines(317)
    lines.append(
        {"id": "lane-317-id", "ts": "2026-06-11T01:00:00+00:00", "status": "teardown_failed"}
    )
    _seed_ledger(tmp_path, lines)
    assert wot._committed_count() == 1
    # ...and 'closed' frees it.
    lines.append({"id": "lane-317-id", "ts": "2026-06-11T02:00:00+00:00", "status": "closed"})
    _seed_ledger(tmp_path, lines)
    assert wot._committed_count() == 0
