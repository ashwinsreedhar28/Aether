"""Wire-shape tests for the MeshDeny error payload (#371).

The SDK used to build ``{"reason": deny.reason, **details}``, so any
``reason`` key inside details clobbered the deny name on the wire. This
pins the fix: the deny name ALWAYS wins.

Run via pytest, or directly: ``python3 core/node_sdk/test_deny_payload.py``.

PARITY PIN: core/node_sdk_ts/test/deny-payload.test.ts builds the same
fixture and asserts this exact canonical string. Keep the two literals
identical.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from node_sdk import MeshDeny, deny_payload  # noqa: E402

PARITY_CANONICAL = '{"code":7,"detail":"human-readable cause","reason":"example_denied"}'


def _canonical(payload: dict) -> str:
    # The dumps parameters Core uses to re-canonicalize wire JSON
    # (core/core/core.py) — the parity pin is over these bytes.
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _colliding_deny() -> MeshDeny:
    deny = MeshDeny("example_denied", detail="human-readable cause", code=7)
    # MeshDeny(reason, **details) rejects a `reason` kwarg outright (it
    # collides with the positional), so in Python a colliding key can only
    # arrive by post-construction mutation — inject it the way a buggy
    # caller would.
    deny.details["reason"] = "clobber"
    return deny


def test_deny_name_wins_colliding_reason_key():
    payload = deny_payload(_colliding_deny())
    assert payload["reason"] == "example_denied"
    assert payload["detail"] == "human-readable cause"
    assert payload["code"] == 7


def test_canonical_wire_shape_parity_with_ts():
    assert _canonical(deny_payload(_colliding_deny())) == PARITY_CANONICAL


def test_collision_free_deny_keeps_detail_keys():
    deny = MeshDeny("finance_untracked_symbol", symbol="ZZZZ")
    assert deny_payload(deny) == {"symbol": "ZZZZ", "reason": "finance_untracked_symbol"}


if __name__ == "__main__":
    failures = 0
    for name in sorted(k for k in globals() if k.startswith("test_")):
        try:
            globals()[name]()
            print(f"ok  {name}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL {name}: {e}")
    sys.exit(1 if failures else 0)
