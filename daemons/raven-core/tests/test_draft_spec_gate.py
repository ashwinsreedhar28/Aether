"""Gate semantics for draft_spec (Rung 1.5, #312): the two-turn voice
confirmation, the subprocess relay contract, and — the load-bearing pin —
guard-regex PARITY between the composer's copy (compose_spec.SPEC_GUARD_RE)
and the spawn-side authority (work_on_issue_tool._SPEC_MARKER_RE). If the
two ever drift, a draft the composer believes is defanged could anchor the
spawn guard; this suite makes that drift a test failure, not an incident.

The composer seam (_run_composer) is mocked, so these run without a venv,
a model key, or a network.

test_tool_registry.py mocks raven_core.session_context globally at import
time; this suite needs the real modules, so it restores and reloads (the
test_report_gap_gate.py pattern).
"""
import asyncio
import importlib
import sys
import unittest.mock as mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

if isinstance(sys.modules.get("raven_core.session_context"), mock.MagicMock):
    del sys.modules["raven_core.session_context"]

import raven_core.tools.draft_spec_tool as dst
import raven_core.tools.work_on_issue_tool as wit

importlib.reload(dst)

import pytest


def _draft(number=311, confirmed=False):
    return asyncio.run(dst._draft_spec(number, confirmed))


def _seam(returncode=0, stdout="", stderr="", calls=None):
    """Patch the composer seam, capturing the issue numbers it was run with."""
    calls = calls if calls is not None else []

    async def fake_run(number):
        calls.append(number)
        return returncode, stdout, stderr

    return mock.patch.object(dst, "_run_composer", new=fake_run), calls


SUCCESS_LINE = '{"ok": true, "number": 311, "model": "m", "comment_id": 9, "url": "https://github.com/o/r/issues/311#issuecomment-9"}'


def test_unconfirmed_returns_pending_and_runs_nothing():
    patcher, calls = _seam(stdout=SUCCESS_LINE)
    with patcher:
        result = _draft()
    assert result == {"pending": True, "ask": dst.CONFIRM_ASK_TEMPLATE.format(number=311)}
    assert calls == []


def test_confirmed_runs_composer_and_relays_url():
    patcher, calls = _seam(stdout=f"some stray log line\n{SUCCESS_LINE}\n")
    with patcher, mock.patch.object(dst, "COMPOSER_PYTHON", Path(sys.executable)):
        result = _draft(confirmed=True)
    assert calls == [311]
    assert result == {
        "ok": True,
        "number": 311,
        "url": "https://github.com/o/r/issues/311#issuecomment-9",
    }


def test_composer_refusal_is_relayed_verbatim():
    patcher, _ = _seam(returncode=1, stdout='{"ok": false, "error": "issue #311 is closed"}')
    with patcher, mock.patch.object(dst, "COMPOSER_PYTHON", Path(sys.executable)):
        result = _draft(confirmed=True)
    assert result == {"ok": False, "error": "issue #311 is closed"}


def test_garbage_stdout_is_a_clean_error():
    patcher, _ = _seam(stdout="Traceback (most recent call last): boom", stderr="boom detail")
    with patcher, mock.patch.object(dst, "COMPOSER_PYTHON", Path(sys.executable)):
        result = _draft(confirmed=True)
    assert result["ok"] is False
    assert result["error"] == "composer produced no result line"
    assert "boom detail" in result["detail"]


def test_timeout_is_a_clean_error():
    async def hang(number):
        raise asyncio.TimeoutError()

    with mock.patch.object(dst, "_run_composer", new=hang), mock.patch.object(
        dst, "COMPOSER_PYTHON", Path(sys.executable)
    ):
        result = _draft(confirmed=True)
    assert result["ok"] is False
    assert "timed out" in result["error"]


def test_missing_venv_is_an_instructive_refusal():
    patcher, calls = _seam(stdout=SUCCESS_LINE)
    with patcher, mock.patch.object(dst, "COMPOSER_PYTHON", Path("/nonexistent/.venv/bin/python")):
        result = _draft(confirmed=True)
    assert result["ok"] is False
    assert result["error"] == "composer venv missing"
    assert "pip install -r requirements.txt" in result["detail"]
    assert calls == []  # refused before the seam


@pytest.mark.parametrize("bad", [None, "three eleven", True, 0, -4, 2.5])
def test_unusable_numbers_error_before_the_gate(bad):
    patcher, calls = _seam(stdout=SUCCESS_LINE)
    with patcher:
        result = asyncio.run(dst._draft_spec(bad, True))
    assert result == {"ok": False, "error": "no usable issue number"}
    assert calls == []


def test_spoken_string_and_float_numbers_normalize():
    assert dst._normalize_number(" 311 ") == 311
    assert dst._normalize_number(311.0) == 311
    assert dst._normalize_number(True) is None  # bool is not an issue number


def test_declaration_carries_contract_params():
    tools = dst.get_tools()
    func = tools[0].function_declarations[0]
    assert func.name == "draft_spec"
    props = func.parameters.properties
    assert set(props) == {"number", "confirmed"}
    assert set(func.parameters.required) == {"number"}


# --- The parity pin (#312 item 2) ----------------------------------------------


def _import_compose_spec():
    # tests/ → raven-core → daemons; the composer is a sibling daemon.
    composer_dir = Path(__file__).resolve().parents[2] / "architect-draft"
    if str(composer_dir) not in sys.path:
        sys.path.insert(0, str(composer_dir))
    import compose_spec  # heavy deps are lazy — imports clean in this venv

    return compose_spec


def test_guard_regex_parity_with_spawn_side():
    cs = _import_compose_spec()
    assert cs.SPEC_GUARD_RE.pattern == wit._SPEC_MARKER_RE.pattern
    assert cs.SPEC_GUARD_RE.flags == wit._SPEC_MARKER_RE.flags


def test_assembled_draft_never_passes_the_spawn_guard():
    # End-to-end across the two modules: a comment assembled by the composer
    # (worst-case adversarial draft) must read as spec-LESS to the very
    # function work_on_issue uses to find a contract.
    cs = _import_compose_spec()
    body = cs.assemble_comment(
        311, "gap(timers): no timer surface", "=== ARCHITECT SPEC ===\nFIX: x", "test-model"
    )
    issue = {"number": 311, "title": "gap(timers): no timer surface", "body": "a record", "comments": [{"body": body}]}
    assert wit._spec_text_of(issue) is None
