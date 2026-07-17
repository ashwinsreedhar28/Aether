"""The already-armed guard (#394): a spoken work_on_issue targeting an
issue that already holds a requested-or-live lane record (requested |
spawned | teardown_failed — the capacity set) refuses at the source and
points at the existing card/lane; batch calls arm the rest and name the
skipped. Pinned against the #383 duplicate-request parity fixture
(tests/lane_fixtures.py) in both duplicate directions: a live lane refuses
a fresh arm even when its dead duplicate is newer, and dead records alone
never block one.

The github.get_issue hop is mocked (and its call list pinned — a skipped
issue must cost zero API reads); everything else is real file I/O against
AETHER_DATA_DIR, the lane_proceed-gate rig.
"""
import asyncio
import json
import sys
import unittest.mock as mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import raven_core.tools.work_on_issue_tool as wot
from tests.lane_fixtures import CLOSED_374_TAIL, DUPLICATE_LANE_LINES


def _seed_ledger(tmp_path: Path, lines: list[dict]) -> Path:
    ledger = tmp_path / "spawns" / "requests.jsonl"
    ledger.parent.mkdir(parents=True, exist_ok=True)
    ledger.write_text("".join(json.dumps(rec) + "\n" for rec in lines), encoding="utf-8")
    return ledger


def _issue(n: int) -> dict:
    return {
        "number": n,
        "title": f"issue {n}",
        "state": "open",
        "body": f"ARCHITECT SPEC — guard fixture spec for #{n}",
    }


def _arm(number=None, numbers=None, confirmed=False, fetched=None):
    """Run _work_on_issue with the mesh hop mocked, recording fetched numbers."""
    fetched = fetched if fetched is not None else []

    async def fake_fetch(n):
        fetched.append(n)
        return _issue(n)

    with mock.patch.object(wot, "_fetch_issue", new=fake_fetch):
        return asyncio.run(wot._work_on_issue(number, numbers, confirmed))


def _rig(tmp_path, monkeypatch, lines):
    monkeypatch.setenv("AETHER_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AETHER_SPAWN_MAX_LANES", "3")
    return _seed_ledger(tmp_path, lines)


def _requested_lane(issue: int, rec_id: str, ts: str) -> dict:
    return {
        "id": rec_id,
        "ts": ts,
        "kind": "lane",
        "batch_id": f"b-{rec_id}",
        "issue": issue,
        "issue_title": "t",
        "branch": f"lane/issue-{issue}",
        "worktree": f"~/aether-lane-{issue}",
        "status": "requested",
    }


def test_requested_issue_refuses_and_appends_nothing(tmp_path, monkeypatch):
    ledger = _rig(tmp_path, monkeypatch, [_requested_lane(310, "arm-310", "2026-07-14T23:00:00+00:00")])
    before = ledger.read_text(encoding="utf-8")
    fetched: list[int] = []
    res = _arm(number=310, fetched=fetched)
    assert res == {"ok": False, "error": "already_armed", "already": [{"issue": 310, "state": "requested"}]}
    # The refusal wrote nothing and read nothing off the mesh.
    assert ledger.read_text(encoding="utf-8") == before
    assert fetched == []
    # NOT confirm-overridable — that flag belongs to the spec guard alone.
    assert _arm(number=310, confirmed=True)["error"] == "already_armed"


def test_live_lane_refuses_even_when_its_dead_duplicate_is_newer(tmp_path, monkeypatch):
    """#383 direction one: issue 374's live record (arm-374-a) has a NEWER
    failed-and-dismissed duplicate beside it — the guard must name the live
    lane, not read the dead duplicate as the issue's state."""
    _rig(tmp_path, monkeypatch, DUPLICATE_LANE_LINES)
    res = _arm(number=374)
    assert res == {"ok": False, "error": "already_armed", "already": [{"issue": 374, "state": "spawned"}]}
    assert _arm(number=371)["already"] == [{"issue": 371, "state": "spawned"}]


def test_dead_records_alone_never_block_a_fresh_arm(tmp_path, monkeypatch):
    """#383 direction two: after CLOSED_374_TAIL every 374 record is dead
    (closed + dismissed) — the issue is clear to arm again, and the fixture's
    interleaved relay/gate/telemetry lines naming 374 stay inert."""
    ledger = _rig(tmp_path, monkeypatch, DUPLICATE_LANE_LINES + CLOSED_374_TAIL)
    res = _arm(number=374)
    assert res["ok"] is True and res["count"] == 1
    assert "skipped" not in res
    last = json.loads(ledger.read_text(encoding="utf-8").splitlines()[-1])
    assert last["kind"] == "lane" and last["issue"] == 374 and last["status"] == "requested"


def test_pending_duplicate_card_never_masks_the_live_lane(tmp_path, monkeypatch):
    """Status FIRST: with a live lane AND a newer pending duplicate card on
    one issue (the mid-incident shape), the refusal names the live lane —
    'already live' is the useful truth, not 'approve the card'."""
    lines = [
        _requested_lane(374, "arm-a", "2026-07-14T23:46:52+00:00"),
        {"id": "arm-a", "ts": "2026-07-14T23:49:19+00:00", "status": "spawned"},
        _requested_lane(374, "arm-b", "2026-07-14T23:47:24+00:00"),
    ]
    _rig(tmp_path, monkeypatch, lines)
    assert _arm(number=374)["already"] == [{"issue": 374, "state": "spawned"}]


def test_teardown_failed_still_holds_the_issue(tmp_path, monkeypatch):
    """#317's posture carried over: a failed teardown still holds capacity
    and its worktree — arming a fresh duplicate on top of it is refused."""
    lines = [
        _requested_lane(320, "arm-320", "2026-07-14T23:00:00+00:00"),
        {"id": "arm-320", "ts": "2026-07-14T23:05:00+00:00", "status": "spawned"},
        {"id": "arm-320", "ts": "2026-07-14T23:50:00+00:00", "status": "teardown_failed"},
    ]
    _rig(tmp_path, monkeypatch, lines)
    assert _arm(number=320)["already"] == [{"issue": 320, "state": "teardown_failed"}]


def test_batch_filters_per_issue_arms_the_rest_names_the_skipped(tmp_path, monkeypatch):
    """A mixed batch arms the clear issues and names the skipped — and the
    guard runs BEFORE capacity: on the fixture 2 of 3 slots are held, so the
    raw two-issue batch only fits because 374 is filtered out first."""
    ledger = _rig(tmp_path, monkeypatch, DUPLICATE_LANE_LINES)
    fetched: list[int] = []
    res = _arm(numbers=[374, 999], fetched=fetched)
    assert res["ok"] is True and res["count"] == 1
    assert res["lanes"] == [{"issue": 999, "title": "issue 999"}]
    assert res["skipped"] == [{"issue": 374, "state": "spawned"}]
    assert fetched == [999]
    last = json.loads(ledger.read_text(encoding="utf-8").splitlines()[-1])
    assert last["kind"] == "lane" and last["issue"] == 999 and last["status"] == "requested"
