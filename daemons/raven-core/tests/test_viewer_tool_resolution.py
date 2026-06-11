"""App-id resolution semantics for the viewer tool (#243): name-aware
fuzzy matching ('text editor' must find id 'text-viewer'), the `id`
alias for open_app's app_id argument, failure results that always carry
the valid ids, and an anti-drift gate pinning APP_HINTS to the shell's
live app registry source.

The mesh hop is mocked (patch viewer_tool.mesh_invoke), so these run
without a live mesh.
"""
import asyncio
import re
import sys
import unittest.mock as mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

# Same global mock test_tool_registry.py uses: importing raven_core.tools
# (the package __init__) pulls session_context's deep import chain.
if "raven_core.session_context" not in sys.modules:
    sys.modules["raven_core.session_context"] = mock.MagicMock()

import pytest

import raven_core.tools.viewer_tool as vt

REGISTRY = [
    {"id": "browser", "name": "Browser"},
    {"id": "kanban-board", "name": "Kanban"},
    {"id": "markdown-viewer", "name": "Markdown Editor"},
    {"id": "text-viewer", "name": "Text Editor"},
    {"id": "terminal", "name": "Terminal"},
]
REGISTRY_IDS = [a["id"] for a in REGISTRY]


# ---------------------------------------------------------------- fuzzy match

def test_fuzzy_matches_display_name_when_id_drifted():
    # The drift that kept #243 alive: apps NAMED 'Markdown Editor' /
    # 'Text Editor' register under -viewer ids.
    assert vt._fuzzy_match_app("text-editor", REGISTRY) == ["text-viewer"]
    assert vt._fuzzy_match_app("markdown editor", REGISTRY) == ["markdown-viewer"]


def test_fuzzy_exact_id_still_wins():
    assert vt._fuzzy_match_app("kanban-board", REGISTRY) == ["kanban-board"]


def test_fuzzy_substring_containment_on_ids():
    assert vt._fuzzy_match_app("kanban", REGISTRY) == ["kanban-board"]


def test_fuzzy_no_match_returns_empty():
    assert vt._fuzzy_match_app("flux-capacitor", REGISTRY) == []
    assert vt._fuzzy_match_app("", REGISTRY) == []


def test_fuzzy_tolerates_nameless_entries():
    # The fallback path wraps bare ids as {'id': ...} dicts with no name.
    assert vt._fuzzy_match_app("text viewer", [{"id": "text-viewer"}]) == [
        "text-viewer"
    ]


# ------------------------------------------------------------------ open_app

def _mesh(responses):
    """Mock mesh_invoke returning queued responses per surface."""

    async def invoke(surface, payload):
        handler = responses[surface]
        return handler.pop(0) if isinstance(handler, list) else handler

    return invoke


def test_open_app_resolves_name_and_retries_once():
    miss = {"ok": False, "available": REGISTRY_IDS}
    hit = {"ok": True, "windowId": "w1"}
    responses = {
        "viewer_desktop.open_app": [miss, hit],
        "viewer_desktop.list_apps": {"apps": REGISTRY},
    }
    with mock.patch.object(vt, "mesh_invoke", _mesh(responses)):
        result = asyncio.run(vt._open_app("text editor", ""))
    assert result == {
        "ok": True,
        "app_id": "text-viewer",
        "resolved_from": "text editor",
        "window_id": "w1",
    }


def test_open_app_unknown_id_returns_available_apps():
    miss = {"ok": False, "available": REGISTRY_IDS}
    responses = {
        "viewer_desktop.open_app": [miss],
        "viewer_desktop.list_apps": {"apps": REGISTRY},
    }
    with mock.patch.object(vt, "mesh_invoke", _mesh(responses)):
        result = asyncio.run(vt._open_app("flux-capacitor", ""))
    assert result["ok"] is False
    assert result["error"] == "unknown_app"
    assert result["available_apps"] == REGISTRY_IDS
    assert result["did_you_mean"] is None


def test_open_app_falls_back_to_bare_ids_when_registry_read_fails():
    queue = [
        {"ok": False, "available": REGISTRY_IDS},
        {"ok": True, "windowId": "w2"},
    ]

    async def invoke(surface, payload):
        if surface == "viewer_desktop.list_apps":
            raise vt.MeshUnavailable("down")
        return queue.pop(0)

    with mock.patch.object(vt, "mesh_invoke", invoke):
        result = asyncio.run(vt._open_app("kanban", ""))
    assert result["ok"] is True
    assert result["app_id"] == "kanban-board"


def test_open_app_empty_id_still_lists_apps():
    responses = {"viewer_desktop.list_apps": {"apps": REGISTRY}}
    with mock.patch.object(vt, "mesh_invoke", _mesh(responses)):
        result = asyncio.run(vt._open_app("", ""))
    assert result["ok"] is False
    assert result["error"] == "bad_app_id"
    assert result["available_apps"] == REGISTRY_IDS


def test_handle_call_accepts_id_alias():
    # Older prompt examples taught open_app({ id: ... }); the handler
    # must not dead-end on the alias.
    hit = {"ok": True, "windowId": "w3"}
    responses = {"viewer_desktop.open_app": [hit]}
    with mock.patch.object(vt, "mesh_invoke", _mesh(responses)):
        result = asyncio.run(vt.handle_call_async("open_app", {"id": "browser"}))
    assert result == {"ok": True, "app_id": "browser", "window_id": "w3"}


# ----------------------------------------------------------------- anti-drift

def _shell_registry_ids():
    """Extract registered app ids from the shell's auto-glob source."""
    apps_dir = Path(__file__).resolve().parents[3] / "shell" / "src" / "apps"
    if not apps_dir.is_dir():
        pytest.skip("shell/src/apps not present in this checkout")
    ids = set()
    for index in apps_dir.glob("*/index.ts"):
        m = re.search(r"id:\s*['\"]([^'\"]+)['\"]", index.read_text())
        if m:
            ids.add(m.group(1))
    return ids


def test_app_hints_exist_in_shell_registry():
    # APP_HINTS is deliberately a non-load-bearing subset, but every
    # entry must be a VERBATIM registry id — 'markdown-editor' /
    # 'text-editor' drifted dead once (#243) and the model dutifully
    # passed them.
    registry = _shell_registry_ids()
    stale = set(vt.APP_HINTS) - registry
    assert not stale, f"APP_HINTS entries missing from shell registry: {stale}"
