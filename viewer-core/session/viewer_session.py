#!/usr/bin/env python3
"""viewer_session — the mesh-resident viewer session node.

Today each shell (viewer_desktop / viewer_spatial) tracks its own open Views
locally. This node holds the *canonical* set of open Views on the mesh so an
agent can move a whole workspace from desktop -> Vision Pro (or back) with ONE
call: `session_handoff`.

Session state (in-memory):
    session = { "views": [View, ...], "focused": Optional[str], "updated": iso }

Five surfaces (mirrors mesh/viewer-surfaces.json conventions — all are
`tool` / `request_response`, because every call returns state the agent reasons
over next):
    session_get()                 -> {views, focused, updated}
    session_set({views, focused?})-> {ok, count}
    session_add({view})           -> {ok, count}
    session_remove({id})          -> {ok, count}
    session_handoff({target})     -> {ok, target, opened: [ids]}   # headline

Every View entering the session is validated with the SAME rules the TS side
enforces (viewer_core.assert_view), so a session is accepted/rejected
identically regardless of which shell authored it.

CAVEAT: state is in-memory only. A node restart loses the session. That is an
intentional Wave-3 scope choice (see viewer-core/session README / summary); a
persistence file would be a trivial follow-up.
"""

from __future__ import annotations

import asyncio
import datetime as _dt
import logging
import os
import sys
from typing import Any, Awaitable, Callable, Optional

# viewer_core (the Python View validator) lives one dir up under python/.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
# The Lattice node SDK (MeshNode, MeshDeny).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "Lattice"))

from viewer_core import assert_view  # noqa: E402
from node_sdk import MeshDeny, MeshNode  # noqa: E402

log = logging.getLogger("viewer_session")

# Logical handoff target -> the viewer node id that exposes open_view/focus_view
# on the mesh. Both shells expose the identical 5-surface contract (Wave 2).
TARGET_NODES = {"desktop": "viewer_desktop", "spatial": "viewer_spatial"}

# An async mesh-client call: (target_surface, payload) -> response dict.
# Defaults to MeshNode.invoke once the node is live; tests inject a stub sink.
Invoker = Callable[[str, dict], Awaitable[dict]]


def now_iso() -> str:
    """Current UTC time as an ISO-8601 string."""
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def _dedupe_by_id(views: list[dict]) -> list[dict]:
    """Collapse Views sharing an id: first position wins, last value wins.

    Keeps the session a set-by-id (an id addresses exactly one View) while
    preserving a stable order for handoff fan-out.
    """
    order: list[str] = []
    by_id: dict[str, dict] = {}
    for v in views:
        vid = v["id"]
        if vid not in by_id:
            order.append(vid)
        by_id[vid] = v
    return [by_id[vid] for vid in order]


class ViewerSession:
    """In-memory canonical session state + the five surface handlers.

    Handlers are pure async functions of `env` (the mesh envelope dict) and read
    `env["payload"]`. They never touch a running Core, so tests call them
    directly with synthetic envelopes and assert state transitions.

    `invoker` is the mesh-client call session_handoff uses to drive the target
    node's open_view/focus_view surfaces. It is None until the node connects
    (main() sets it to node.invoke); tests inject a stub.
    """

    def __init__(self, invoker: Optional[Invoker] = None) -> None:
        self.views: list[dict] = []
        self.focused: Optional[str] = None
        self.updated: str = now_iso()
        self.invoker: Optional[Invoker] = invoker

    # state helpers -----------------------------------------------------

    def snapshot(self) -> dict:
        """The full session, as session_get returns it."""
        return {
            "views": [dict(v) for v in self.views],
            "focused": self.focused,
            "updated": self.updated,
        }

    def _touch(self) -> None:
        self.updated = now_iso()

    def _index(self, vid: str) -> Optional[int]:
        return next((i for i, v in enumerate(self.views) if v.get("id") == vid), None)

    def _prune_focus(self) -> None:
        """Drop a dangling focus that no longer points at an open View."""
        if self.focused is not None and self._index(self.focused) is None:
            self.focused = None

    # surface handlers --------------------------------------------------

    async def session_get(self, env: dict) -> dict:
        """Return the full session {views, focused, updated}."""
        return self.snapshot()

    async def session_set(self, env: dict) -> dict:
        """Replace the whole session. Validates every incoming View."""
        payload = env.get("payload") or {}
        views = payload.get("views")
        if not isinstance(views, list):
            raise MeshDeny("invalid_payload", detail="views must be a list")
        for v in views:
            try:
                assert_view(v)
            except ValueError as e:
                raise MeshDeny("invalid_view", detail=str(e))
        self.views = _dedupe_by_id(views)
        focused = payload.get("focused")
        self.focused = focused if isinstance(focused, str) and focused else None
        self._prune_focus()
        self._touch()
        return {"ok": True, "count": len(self.views)}

    async def session_add(self, env: dict) -> dict:
        """Validate + upsert one View by id."""
        payload = env.get("payload") or {}
        view = payload.get("view")
        try:
            assert_view(view)
        except ValueError as e:
            raise MeshDeny("invalid_view", detail=str(e))
        idx = self._index(view["id"])
        if idx is None:
            self.views.append(view)
        else:
            self.views[idx] = view
        self._touch()
        return {"ok": True, "count": len(self.views)}

    async def session_remove(self, env: dict) -> dict:
        """Drop a View by id. No-op (still ok) if the id is absent."""
        payload = env.get("payload") or {}
        vid = payload.get("id")
        if not isinstance(vid, str) or not vid:
            raise MeshDeny("invalid_payload", detail="id must be a non-empty string")
        idx = self._index(vid)
        if idx is not None:
            self.views.pop(idx)
            if self.focused == vid:
                self.focused = None
            self._touch()
        return {"ok": True, "count": len(self.views)}

    async def session_handoff(self, env: dict) -> dict:
        """Rehydrate the whole session onto `target` ∈ {desktop, spatial}.

        For each View (in session order) invoke the target node's `open_view`
        surface over the mesh, then focus the focused one. ONE call moves the
        workspace across devices.
        """
        payload = env.get("payload") or {}
        target = payload.get("target")
        if target not in TARGET_NODES:
            raise MeshDeny(
                "invalid_target",
                detail=f"target must be one of {sorted(TARGET_NODES)}",
            )
        if self.invoker is None:
            raise MeshDeny("no_invoker", detail="session node not connected to mesh")
        node_id = TARGET_NODES[target]
        opened: list[str] = []
        for v in self.views:
            await self.invoker(f"{node_id}.open_view", v)
            opened.append(v["id"])
        if self.focused is not None and self.focused in opened:
            await self.invoker(f"{node_id}.focus_view", {"id": self.focused})
        return {"ok": True, "target": target, "opened": opened}

    # wiring ------------------------------------------------------------

    def register(self, node: MeshNode) -> None:
        """Bind handlers to a live MeshNode and point the invoker at it."""
        node.on("session_get", self.session_get)
        node.on("session_set", self.session_set)
        node.on("session_add", self.session_add)
        node.on("session_remove", self.session_remove)
        node.on("session_handoff", self.session_handoff)
        self.invoker = node.invoke


async def main() -> int:
    node_id = os.getenv("NODE_ID", "viewer_session")
    secret = os.getenv("MESH_VIEWER_SESSION_SECRET")
    core_url = os.getenv("MESH_CORE_URL", "http://127.0.0.1:8000")

    if not secret:
        log.error("MESH_VIEWER_SESSION_SECRET environment variable required")
        return 2

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )
    log.info("viewer_session starting (node_id=%s core_url=%s)", node_id, core_url)

    node = MeshNode(node_id=node_id, secret=secret, core_url=core_url)
    session = ViewerSession()
    session.register(node)

    try:
        await node.start()
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        log.info("Shutting down (interrupted)")
    finally:
        await node.stop()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
