"""Cross-language validator parity (Python side) + unit coverage.

The parity tests run the SHARED fixture battery (../schema/fixtures.json) through
`validate_view`. The vitest suite (src/schema/parity.test.ts) runs the SAME file
through the TS `validateView`. One fixtures file, two readers — the validators
cannot drift: a verdict flip on either side turns that side's run red.

The unit tests give the Python validator the same direct coverage the TS
view.test.ts gives the TS one.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from viewer_core import VIEW_TYPES, assert_view, validate_view

HERE = Path(__file__).resolve().parent
FIXTURES = json.loads((HERE.parent / "schema" / "fixtures.json").read_text())

VALID = FIXTURES["valid"]
INVALID = FIXTURES["invalid"]


def test_battery_is_non_trivial():
    assert len(VALID) > 5
    assert len(INVALID) > 5


@pytest.mark.parametrize("fx", VALID, ids=[f["name"] for f in VALID])
def test_accepts_valid(fx):
    r = validate_view(fx["view"])
    assert r.ok, f"expected ACCEPT for {fx['name']!r}, got errors: {r.errors}"


@pytest.mark.parametrize("fx", INVALID, ids=[f["name"] for f in INVALID])
def test_rejects_invalid(fx):
    r = validate_view(fx["view"])
    assert not r.ok, f"expected REJECT for {fx['name']!r}, but validator accepted it"


# --- direct unit coverage (mirrors src/schema/view.test.ts) ----------------


def test_accepts_well_formed_view():
    r = validate_view(
        {
            "id": "v1",
            "type": "markdown",
            "title": "Notes",
            "source": {"kind": "inline", "value": "# hi"},
            "layout": {"w": 0.8, "h": 0.6, "hint": "wide"},
        }
    )
    assert r.ok
    assert r.errors == []


@pytest.mark.parametrize("vtype", VIEW_TYPES)
def test_accepts_every_declared_type(vtype):
    r = validate_view({"id": "x", "type": vtype, "source": {"kind": "path", "value": "/a"}})
    assert r.ok, f"type {vtype} should be valid"


def test_rejects_missing_id():
    r = validate_view({"type": "markdown", "source": {"kind": "inline", "value": "x"}})
    assert not r.ok
    assert any("id" in e for e in r.errors)


def test_rejects_unknown_type():
    r = validate_view({"id": "a", "type": "spreadsheet", "source": {"kind": "inline", "value": "x"}})
    assert not r.ok
    assert any("type" in e for e in r.errors)


def test_rejects_missing_source():
    r = validate_view({"id": "a", "type": "json"})
    assert not r.ok
    assert any("source is required" in e for e in r.errors)


def test_assert_view_roundtrips_and_raises():
    good = {"id": "a", "type": "json", "source": {"kind": "inline", "value": "x"}}
    assert assert_view(good) is good
    with pytest.raises(ValueError, match="Invalid View"):
        assert_view({"id": "a"})
