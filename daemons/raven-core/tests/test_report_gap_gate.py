"""Gate semantics for report_gap (#255 / #258): the two-turn voice
confirmation, the gaps.auto_file knob, and the per-session rate guard.

These tests pin the ruled behaviour through the Lane-A rebase: the
filing seam (_file_gap) is mocked, so everything here keeps passing
when the seam repoints from intents.record to github.create_issue —
only the seam's own body changes.

test_tool_registry.py mocks raven_core.session_context globally at
import time; this suite needs the REAL SessionContext and Config, so it
restores the real module and reloads the tool to rebind its imports.
"""
import asyncio
import importlib
import sys
import unittest.mock as mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

# Undo test_tool_registry's global session_context mock if it ran first
# in the same pytest session, then rebind the tool to the real modules.
if isinstance(sys.modules.get("raven_core.session_context"), mock.MagicMock):
    del sys.modules["raven_core.session_context"]

import raven_core.config as config_mod
import raven_core.session_context as session_context
import raven_core.tools.report_gap_tool as rgt

importlib.reload(rgt)

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
    """Patch the filing seam, capturing the assembled record."""
    captured = {}

    async def fake_file_gap(record):
        captured.update(record)
        return result if result is not None else {"ok": True, "id": "test-id"}

    return mock.patch.object(rgt, "_file_gap", new=fake_file_gap), captured


def test_unconfirmed_returns_pending_and_files_nothing():
    ctx = _fresh_state(auto_file=False)
    patcher, captured = _capture_file_gap()
    with patcher:
        result = asyncio.run(rgt._report_gap("user asked to dim lights; no surface", None, False))
    assert result == {"pending": True, "ask": rgt.CONFIRM_PROMPT}
    assert captured == {}
    assert ctx.gap_creates == 0


def test_confirmed_files_and_counts():
    ctx = _fresh_state(auto_file=False)
    ctx.add_utterance("dim the lights please")
    patcher, captured = _capture_file_gap()
    with patcher:
        result = asyncio.run(rgt._report_gap("user asked to dim lights; no surface", "ctx", True))
    assert result["ok"] is True
    assert ctx.gap_creates == 1
    # The full record (#255 item 3) is assembled at the seam: verbatim
    # utterance, session id, timestamp.
    assert captured["utterance"] == "dim the lights please"
    assert captured["session_id"] == ctx.session_id
    assert captured["context"] == "ctx"
    assert captured["ts"]


def test_auto_file_files_on_first_call():
    ctx = _fresh_state(auto_file=True)
    patcher, captured = _capture_file_gap()
    with patcher:
        result = asyncio.run(rgt._report_gap("user asked to play music; no surface", None, False))
    assert result["ok"] is True
    assert ctx.gap_creates == 1
    assert captured["text"] == "user asked to play music; no surface"


def test_rate_guard_suspends_auto_file():
    ctx = _fresh_state(auto_file=True)
    ctx.gap_creates = rgt.SESSION_CREATE_SOFT_LIMIT
    patcher, captured = _capture_file_gap()
    with patcher:
        result = asyncio.run(rgt._report_gap("user asked for a sixth thing; no surface", None, False))
    assert result["pending"] is True
    assert result["reason"] == "rate_guard"
    assert captured == {}
    assert ctx.gap_creates == rgt.SESSION_CREATE_SOFT_LIMIT


def test_confirmed_allowed_past_limit():
    ctx = _fresh_state(auto_file=True)
    ctx.gap_creates = rgt.SESSION_CREATE_SOFT_LIMIT
    patcher, _ = _capture_file_gap()
    with patcher:
        result = asyncio.run(rgt._report_gap("user asked for a sixth thing; no surface", None, True))
    assert result["ok"] is True
    assert ctx.gap_creates == rgt.SESSION_CREATE_SOFT_LIMIT + 1


def test_no_config_defaults_to_confirmation_gate():
    ctx = _fresh_state()
    config_mod.set_active_config(None)
    patcher, captured = _capture_file_gap()
    with patcher:
        result = asyncio.run(rgt._report_gap("user asked X; no surface", None, False))
    assert result["pending"] is True
    assert captured == {}


def test_empty_text_errors():
    _fresh_state()
    result = asyncio.run(rgt._report_gap("   ", None, True))
    assert result == {"error": "empty gap description"}


def test_mesh_unavailable_does_not_count():
    ctx = _fresh_state()

    async def raise_unavailable(surface, payload):
        raise rgt.MeshUnavailable("mesh down")

    with mock.patch.object(rgt, "mesh_invoke", new=raise_unavailable):
        result = asyncio.run(rgt._report_gap("user asked X; no surface", None, True))
    assert result["error"] == "mesh unavailable"
    assert ctx.gap_creates == 0


def test_declaration_carries_confirmed_param():
    tools = rgt.get_tools()
    func = tools[0].function_declarations[0]
    assert func.name == "report_gap"
    assert "confirmed" in func.parameters.properties
    assert "text" in func.parameters.required
    assert "confirmed" not in func.parameters.required


def test_session_id_reminted_on_reset():
    ctx = session_context.get_session_context()
    before = ctx.session_id
    ctx.gap_creates = 3
    ctx.reset()
    assert ctx.session_id != before
    assert ctx.gap_creates == 0
