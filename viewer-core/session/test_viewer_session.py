"""Pytest suite for the viewer_session node.

Proves all five surfaces + the handoff fan-out WITHOUT a running Lattice Core:
handlers are called directly with synthetic `env` dicts, and the target-node
invocation is stubbed with a sink that records every (surface, payload) call.

Fixture-based and discoverable by `pytest` — no __main__/sys.exit runner.
"""

from __future__ import annotations

import asyncio

import pytest

from node_sdk import MeshDeny
from viewer_session import TARGET_NODES, ViewerSession, _dedupe_by_id


# --- helpers ---------------------------------------------------------------


def env(payload: dict | None = None) -> dict:
    """Build a synthetic mesh envelope the way Core would deliver one."""
    return {"id": "msg-1", "from": "agent", "to": "viewer_session.x",
            "kind": "invocation", "payload": payload or {}}


def view(vid: str, vtype: str = "markdown", value: str = "# hi") -> dict:
    """A minimal valid View."""
    return {"id": vid, "type": vtype, "title": vid,
            "source": {"kind": "inline", "value": value}}


class InvokerSink:
    """Stub for the mesh-client invoker: records calls, returns a canned ok."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    async def __call__(self, target_surface: str, payload: dict) -> dict:
        self.calls.append((target_surface, payload))
        return {"ok": True, "id": payload.get("id")}


# --- fixtures --------------------------------------------------------------


@pytest.fixture
def sink() -> InvokerSink:
    return InvokerSink()


@pytest.fixture
def session(sink: InvokerSink) -> ViewerSession:
    return ViewerSession(invoker=sink)


# --- session_get / session_set --------------------------------------------


def test_get_starts_empty(session: ViewerSession) -> None:
    snap = asyncio.run(session.session_get(env()))
    assert snap["views"] == []
    assert snap["focused"] is None
    assert isinstance(snap["updated"], str)


def test_set_replaces_and_counts(session: ViewerSession) -> None:
    res = asyncio.run(session.session_set(env({
        "views": [view("a"), view("b")],
        "focused": "b",
    })))
    assert res == {"ok": True, "count": 2}
    snap = asyncio.run(session.session_get(env()))
    assert [v["id"] for v in snap["views"]] == ["a", "b"]
    assert snap["focused"] == "b"


def test_set_dedupes_by_id_last_value_wins(session: ViewerSession) -> None:
    res = asyncio.run(session.session_set(env({
        "views": [view("a", value="first"), view("b"), view("a", value="second")],
    })))
    assert res["count"] == 2
    snap = asyncio.run(session.session_get(env()))
    assert [v["id"] for v in snap["views"]] == ["a", "b"]
    assert snap["views"][0]["source"]["value"] == "second"


def test_set_drops_dangling_focus(session: ViewerSession) -> None:
    asyncio.run(session.session_set(env({
        "views": [view("a")],
        "focused": "ghost",
    })))
    snap = asyncio.run(session.session_get(env()))
    assert snap["focused"] is None


def test_set_rejects_invalid_view(session: ViewerSession) -> None:
    bad = {"id": "x", "type": "not-a-real-type",
           "source": {"kind": "inline", "value": "y"}}
    with pytest.raises(MeshDeny) as ei:
        asyncio.run(session.session_set(env({"views": [bad]})))
    assert ei.value.reason == "invalid_view"


def test_set_rejects_non_list_views(session: ViewerSession) -> None:
    with pytest.raises(MeshDeny) as ei:
        asyncio.run(session.session_set(env({"views": "nope"})))
    assert ei.value.reason == "invalid_payload"


# --- session_add -----------------------------------------------------------


def test_add_appends_new_view(session: ViewerSession) -> None:
    asyncio.run(session.session_set(env({"views": [view("a")]})))
    res = asyncio.run(session.session_add(env({"view": view("b")})))
    assert res == {"ok": True, "count": 2}
    snap = asyncio.run(session.session_get(env()))
    assert [v["id"] for v in snap["views"]] == ["a", "b"]


def test_add_upserts_existing_in_place(session: ViewerSession) -> None:
    asyncio.run(session.session_set(env({"views": [view("a", value="old"), view("b")]})))
    res = asyncio.run(session.session_add(env({"view": view("a", value="new")})))
    assert res["count"] == 2  # not 3 — upsert, not append
    snap = asyncio.run(session.session_get(env()))
    assert [v["id"] for v in snap["views"]] == ["a", "b"]  # position preserved
    assert snap["views"][0]["source"]["value"] == "new"


def test_add_rejects_invalid_view(session: ViewerSession) -> None:
    with pytest.raises(MeshDeny) as ei:
        asyncio.run(session.session_add(env({"view": {"id": "x"}})))
    assert ei.value.reason == "invalid_view"


# --- session_remove --------------------------------------------------------


def test_remove_drops_view(session: ViewerSession) -> None:
    asyncio.run(session.session_set(env({"views": [view("a"), view("b")], "focused": "a"})))
    res = asyncio.run(session.session_remove(env({"id": "a"})))
    assert res == {"ok": True, "count": 1}
    snap = asyncio.run(session.session_get(env()))
    assert [v["id"] for v in snap["views"]] == ["b"]
    assert snap["focused"] is None  # focus cleared with the removed view


def test_remove_absent_id_is_noop(session: ViewerSession) -> None:
    asyncio.run(session.session_set(env({"views": [view("a")]})))
    res = asyncio.run(session.session_remove(env({"id": "ghost"})))
    assert res == {"ok": True, "count": 1}


def test_remove_rejects_empty_id(session: ViewerSession) -> None:
    with pytest.raises(MeshDeny) as ei:
        asyncio.run(session.session_remove(env({"id": ""})))
    assert ei.value.reason == "invalid_payload"


# --- round trip ------------------------------------------------------------


def test_get_set_add_remove_get_round_trip(session: ViewerSession) -> None:
    assert asyncio.run(session.session_get(env()))["views"] == []
    asyncio.run(session.session_set(env({"views": [view("a")]})))
    asyncio.run(session.session_add(env({"view": view("b")})))
    asyncio.run(session.session_add(env({"view": view("c")})))
    asyncio.run(session.session_remove(env({"id": "b"})))
    snap = asyncio.run(session.session_get(env()))
    assert [v["id"] for v in snap["views"]] == ["a", "c"]


# --- session_handoff (stubbed fan-out) ------------------------------------


def test_handoff_fans_out_every_view_in_order(session: ViewerSession, sink: InvokerSink) -> None:
    asyncio.run(session.session_set(env({
        "views": [view("a"), view("b"), view("c")],
        "focused": "b",
    })))
    res = asyncio.run(session.session_handoff(env({"target": "spatial"})))
    assert res == {"ok": True, "target": "spatial", "opened": ["a", "b", "c"]}

    open_calls = [c for c in sink.calls if c[0].endswith(".open_view")]
    assert [c[0] for c in open_calls] == ["viewer_spatial.open_view"] * 3
    assert [c[1]["id"] for c in open_calls] == ["a", "b", "c"]  # order preserved
    # the full View is forwarded, not just the id
    assert open_calls[0][1]["source"] == {"kind": "inline", "value": "# hi"}


def test_handoff_focuses_focused_view_last(session: ViewerSession, sink: InvokerSink) -> None:
    asyncio.run(session.session_set(env({"views": [view("a"), view("b")], "focused": "b"})))
    asyncio.run(session.session_handoff(env({"target": "desktop"})))
    assert sink.calls[-1] == ("viewer_desktop.focus_view", {"id": "b"})


def test_handoff_no_focus_skips_focus_call(session: ViewerSession, sink: InvokerSink) -> None:
    asyncio.run(session.session_set(env({"views": [view("a")]})))
    asyncio.run(session.session_handoff(env({"target": "desktop"})))
    assert all(not c[0].endswith(".focus_view") for c in sink.calls)


def test_handoff_targets_correct_node(session: ViewerSession, sink: InvokerSink) -> None:
    asyncio.run(session.session_set(env({"views": [view("a")]})))
    asyncio.run(session.session_handoff(env({"target": "desktop"})))
    assert sink.calls[0][0].startswith(TARGET_NODES["desktop"] + ".")


def test_handoff_rejects_unknown_target(session: ViewerSession) -> None:
    asyncio.run(session.session_set(env({"views": [view("a")]})))
    with pytest.raises(MeshDeny) as ei:
        asyncio.run(session.session_handoff(env({"target": "watch"})))
    assert ei.value.reason == "invalid_target"


def test_handoff_without_invoker_denies() -> None:
    detached = ViewerSession(invoker=None)
    asyncio.run(detached.session_set(env({"views": [view("a")]})))
    with pytest.raises(MeshDeny) as ei:
        asyncio.run(detached.session_handoff(env({"target": "spatial"})))
    assert ei.value.reason == "no_invoker"


def test_handoff_empty_session_opens_nothing(session: ViewerSession, sink: InvokerSink) -> None:
    res = asyncio.run(session.session_handoff(env({"target": "spatial"})))
    assert res["opened"] == []
    assert sink.calls == []


# --- unit: dedupe helper ---------------------------------------------------


def test_dedupe_by_id_helper() -> None:
    out = _dedupe_by_id([view("a", value="1"), view("a", value="2"), view("b")])
    assert [v["id"] for v in out] == ["a", "b"]
    assert out[0]["source"]["value"] == "2"
