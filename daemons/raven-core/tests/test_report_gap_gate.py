"""Gate semantics for report_gap (#255 / #258): the two-turn voice
confirmation, the gaps.auto_file knob, the per-session rate guard, and
the github.create_issue payload shape — plus review_gaps' board read.

The filing seam (_file_gap) and the mesh hop are mocked, so these run
without a live mesh; the payload asserts pin the surface contract from
nodes/github/README.md.

test_tool_registry.py mocks raven_core.session_context globally at
import time; this suite needs the REAL SessionContext and Config, so it
restores the real module and reloads the tools to rebind their imports.
"""
import asyncio
import importlib
import sys
import unittest.mock as mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

# Undo test_tool_registry's global session_context mock if it ran first
# in the same pytest session, then rebind the tools to the real modules.
if isinstance(sys.modules.get("raven_core.session_context"), mock.MagicMock):
    del sys.modules["raven_core.session_context"]

import raven_core.config as config_mod
import raven_core.session_context as session_context
import raven_core.tools.report_gap_tool as rgt
import raven_core.tools.review_gaps_tool as rvt

importlib.reload(rgt)
importlib.reload(rvt)

import pytest


def _fresh_state(auto_file: bool = False):
    """Reset the session singleton and register a fresh Config."""
    ctx = session_context.get_session_context()
    ctx.reset()
    config = config_mod.Config()
    config.gaps_auto_file = auto_file
    config_mod.set_active_config(config)
    return ctx


def _capture_file_gap(result=None):
    """Patch the filing seam, capturing the assembled payload."""
    captured = {}

    async def fake_file_gap(payload):
        captured.update(payload)
        return result if result is not None else {"ok": True, "deduped": False, "number": 1}

    return mock.patch.object(rgt, "_file_gap", new=fake_file_gap), captured


def _report(area="lights", summary="user asked to dim lights; no surface",
            failure=None, capability_key=None, confirmed=False):
    return asyncio.run(rgt._report_gap(area, summary, failure, capability_key, confirmed))


def test_unconfirmed_returns_pending_and_files_nothing():
    ctx = _fresh_state(auto_file=False)
    patcher, captured = _capture_file_gap()
    with patcher:
        result = _report()
    assert result == {"pending": True, "ask": rgt.CONFIRM_PROMPT}
    assert captured == {}
    assert ctx.gap_creates == 0


def test_confirmed_files_full_contract_payload():
    ctx = _fresh_state(auto_file=False)
    ctx.add_utterance("dim the lights please")
    patcher, captured = _capture_file_gap()
    with patcher:
        result = _report(failure="no smart-home node registered", confirmed=True)
    assert result["ok"] is True
    assert ctx.gap_creates == 1
    # The surface contract (nodes/github/README.md): area + summary +
    # verbatim utterance + session id; failure optional.
    assert captured["area"] == "lights"
    assert captured["summary"] == "user asked to dim lights; no surface"
    assert captured["utterance"] == "dim the lights please"
    assert captured["session_id"] == ctx.session_id
    assert captured["failure"] == "no smart-home node registered"
    assert "capability_key" not in captured


def test_utterance_falls_back_to_summary():
    _fresh_state(auto_file=True)
    patcher, captured = _capture_file_gap()
    with patcher:
        _report(area="music", summary="user asked to play music; no surface")
    assert captured["utterance"] == "user asked to play music; no surface"


def test_auto_file_files_on_first_call():
    ctx = _fresh_state(auto_file=True)
    patcher, _ = _capture_file_gap()
    with patcher:
        result = _report()
    assert result["ok"] is True
    assert ctx.gap_creates == 1


def test_rate_guard_suspends_auto_file():
    ctx = _fresh_state(auto_file=True)
    ctx.gap_creates = rgt.SESSION_CREATE_SOFT_LIMIT
    patcher, captured = _capture_file_gap()
    with patcher:
        result = _report()
    assert result["pending"] is True
    assert result["reason"] == "rate_guard"
    assert captured == {}
    assert ctx.gap_creates == rgt.SESSION_CREATE_SOFT_LIMIT


def test_confirmed_allowed_past_limit():
    ctx = _fresh_state(auto_file=True)
    ctx.gap_creates = rgt.SESSION_CREATE_SOFT_LIMIT
    patcher, _ = _capture_file_gap()
    with patcher:
        result = _report(confirmed=True)
    assert result["ok"] is True
    assert ctx.gap_creates == rgt.SESSION_CREATE_SOFT_LIMIT + 1


def test_deduped_does_not_hide_ok():
    ctx = _fresh_state(auto_file=True)
    patcher, _ = _capture_file_gap(result={"ok": True, "deduped": True, "number": 7})
    with patcher:
        result = _report()
    assert result == {"ok": True, "deduped": True, "number": 7}
    assert ctx.gap_creates == 1


def test_no_config_defaults_to_confirmation_gate():
    _fresh_state()
    config_mod.set_active_config(None)
    patcher, captured = _capture_file_gap()
    with patcher:
        result = _report()
    assert result["pending"] is True
    assert captured == {}


def test_missing_area_or_summary_errors():
    _fresh_state()
    assert asyncio.run(rgt._report_gap("", "summary", None, None, True)) == {
        "error": "missing area or summary"
    }
    assert asyncio.run(rgt._report_gap("area", "  ", None, None, True)) == {
        "error": "missing area or summary"
    }


def test_no_token_deny_is_named():
    ctx = _fresh_state()

    async def raise_no_token(surface, payload):
        raise rgt.MeshUnavailable("mesh error: github_no_token", reason="github_no_token")

    with mock.patch.object(rgt, "mesh_invoke", new=raise_no_token):
        result = _report(confirmed=True)
    assert result == {"error": "github token not configured — filing unavailable"}
    assert ctx.gap_creates == 0


def test_mesh_unavailable_does_not_count():
    ctx = _fresh_state()

    async def raise_unavailable(surface, payload):
        raise rgt.MeshUnavailable("mesh down")

    with mock.patch.object(rgt, "mesh_invoke", new=raise_unavailable):
        result = _report(confirmed=True)
    assert result["error"] == "mesh unavailable"
    assert ctx.gap_creates == 0


def test_declaration_carries_contract_params():
    tools = rgt.get_tools()
    func = tools[0].function_declarations[0]
    assert func.name == "report_gap"
    props = func.parameters.properties
    for param in ("area", "summary", "failure", "capability_key", "confirmed"):
        assert param in props
    assert set(func.parameters.required) == {"area", "summary"}


def test_session_id_reminted_on_reset():
    ctx = session_context.get_session_context()
    before = ctx.session_id
    ctx.gap_creates = 3
    ctx.reset()
    assert ctx.session_id != before
    assert ctx.gap_creates == 0


# --- review_gaps: the board read (#255 ruling 4) -----------------------


def _list_response(**overrides):
    base = {
        "issues": [
            {"number": 12, "title": "gap(music): user asked to play music; no surface",
             "labels": ["gap"], "comments": 2},
        ],
        "fetched_at_ms": 1,
        "stale": False,
        "token_available": True,
    }
    base.update(overrides)
    return base


def test_review_gaps_reads_gap_labeled_board():
    calls = {}

    async def fake_invoke(surface, payload):
        calls["surface"] = surface
        calls["payload"] = payload
        return _list_response()

    with mock.patch.object(rvt, "mesh_invoke", new=fake_invoke):
        result = asyncio.run(rvt._review_gaps())
    assert calls["surface"] == "github.list_issues"
    assert calls["payload"] == {"labels": "gap", "limit": rvt.REVIEW_LIMIT}
    assert result["ok"] is True
    assert result["count"] == 1
    assert result["gaps"][0]["number"] == 12


def test_review_gaps_no_token_is_error_not_empty_board():
    async def fake_invoke(surface, payload):
        return _list_response(issues=[], token_available=False)

    with mock.patch.object(rvt, "mesh_invoke", new=fake_invoke):
        result = asyncio.run(rvt._review_gaps())
    assert "error" in result
    assert "token" in result["error"]


def test_review_gaps_passes_stale_through():
    async def fake_invoke(surface, payload):
        return _list_response(stale=True)

    with mock.patch.object(rvt, "mesh_invoke", new=fake_invoke):
        result = asyncio.run(rvt._review_gaps())
    assert result["ok"] is True
    assert result["stale"] is True
