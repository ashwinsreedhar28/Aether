"""Gate semantics for lane_revise (#339): the voice confirm gate, the
live-lane guard, the fixed-text relay line shape, and the TS-side parity pin
on the REVISE_TEXT literal.

Pure ledger-file tests — no mesh, no Gemini session: lane_revise_tool is
file I/O only, so AETHER_DATA_DIR pointed at a tmp_path is the whole rig
(the lane_proceed pattern exactly).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import raven_core.tools.lane_revise_tool as lrt
import raven_core.tools.work_on_issue_tool as wot
from tests.lane_fixtures import DUPLICATE_LANE_LINES


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
            "ts": "2026-07-06T00:00:00+00:00",
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
                "ts": "2026-07-06T00:05:00+00:00",
                "status": "spawned",
                "worktree": f"/Users/x/aether-lane-{issue}",
                "branch": f"lane/issue-{issue}",
                "tmux_session": f"lane-{issue}",
            }
        )
    return lines


def test_revise_text_pins_the_ts_allowlist_literal():
    # Kept in sync with spawnLedger.ts REVISE_TEXT (its test pins the same
    # string) — a drift here is a relay the shell refuses at both the write
    # and the execution gates.
    assert lrt.REVISE_TEXT == "revise per the latest DIRECTOR FEEDBACK, then re-gate"


def test_no_lane_record_is_a_named_error(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    res = lrt._lane_revise(339, confirmed=False)
    assert res == {"ok": False, "error": "no lane record for issue #339"}


def test_not_live_lane_is_refused(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    _seed_ledger(tmp_path, _lane_lines(339, spawned=False))
    res = lrt._lane_revise(339, confirmed=False)
    assert res["ok"] is False
    assert "not live" in res["error"]


def test_revise_reaches_the_live_record_behind_a_dead_newer_duplicate(tmp_path, monkeypatch):
    """#383: revise inherits lane_proceed's _lane_status — the duplicate
    shape (tests/lane_fixtures.py) must not refuse the live lane."""
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    _seed_ledger(tmp_path, DUPLICATE_LANE_LINES)
    res = lrt._lane_revise(374, confirmed=False)
    assert res["pending"] is True


def test_first_call_is_pending_never_an_append(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    ledger = _seed_ledger(tmp_path, _lane_lines(339))
    before = ledger.read_text(encoding="utf-8")
    res = lrt._lane_revise(339, confirmed=False)
    assert res["pending"] is True
    assert "DIRECTOR" in res["ask"]
    # The confirm gate wrote NOTHING — the side effect waits for the voice yes.
    assert ledger.read_text(encoding="utf-8") == before


def test_confirmed_call_appends_the_fixed_relay_line(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    ledger = _seed_ledger(tmp_path, _lane_lines(339))
    res = lrt._lane_revise(339, confirmed=True)
    assert res == {"ok": True, "issue": 339}
    last = json.loads(ledger.read_text(encoding="utf-8").splitlines()[-1])
    # The on-disk contract the shell's foldRelays expects: kind-tagged,
    # issue-bound, the REVISE allowlist literal and nothing else.
    assert last["kind"] == "relay"
    assert last["issue"] == 339
    assert last["text"] == "revise per the latest DIRECTOR FEEDBACK, then re-gate"
    assert last["status"] == "requested"
    assert isinstance(last["id"], str) and last["id"]
    assert isinstance(last["ts"], str) and last["ts"]


def test_revise_relay_lines_are_invisible_to_lane_status_and_capacity(tmp_path, monkeypatch):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    _seed_ledger(tmp_path, _lane_lines(339))
    lrt._lane_revise(339, confirmed=True)
    # The pending revise relay neither shadows the lane's status...
    assert lrt._lane_status(339) == "spawned"
    # ...nor holds a capacity slot (relay lines are skipped by kind tag).
    assert wot._committed_count() == 1
