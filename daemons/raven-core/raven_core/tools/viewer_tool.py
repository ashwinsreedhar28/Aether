"""Viewer Tool - Drive the Viewer surface (open/close/focus apps) via the mesh.

raven's hands on the desktop. Each function is a single ``await mesh_invoke``
to the ``viewer_desktop`` control node hosted in the shell main process, which
translates the call into a renderer control action (open a window, focus it,
close it). The edges ``raven → viewer_desktop.*`` in manifest.yaml authorise the
hops; without them Core rejects the envelope.

Same pattern as notify_tool: declare the function, implement as one mesh_invoke,
add the edge. Window-scoped actions (focus/close) take a ``window_id`` the model
gets from ``open_app`` (which returns it) or ``list_windows`` — NOT an app id.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = [
    "open_app",
    "list_apps",
    "list_windows",
    "focus_window",
    "close_window",
    "arrange_windows",
]

# App-id HINTS seeded into the open_app declaration — common spoken targets,
# NOT the full registry (the shell auto-discovers ~25 apps and the set grows;
# a hardcoded mirror here goes stale, which is exactly how 'browser' became
# invisible to the model). Correctness does not depend on this list:
# _open_app fuzzy-resolves unknown ids against the live registry, and the
# error path returns the real id list for in-turn recovery.
APP_HINTS = (
    "browser",
    "terminal",
    "mesh",
    "lanes",
    "gaps",
    "calculator",
    "settings",
    "kanban-board",
    "markdown-editor",
    "text-editor",
)

# Mirrors LAYOUT_PRESETS in shell/electron/main/services/viewerNode.ts.
LAYOUT_PRESETS = ("tile", "focus", "split", "thirds", "quarters")


def _normalize_app_id(s: str) -> str:
    """Lowercase and strip separators so 'Markdown Editor' ≈ 'markdown-editor'."""
    return "".join(c for c in s.lower() if c.isalnum())


def _fuzzy_match_app(requested: str, available: list[str]) -> list[str]:
    """Resolve a spoken/guessed app id against the live registry ids.

    Exact normalized match wins outright; otherwise substring containment
    either way (so 'kanban' finds 'kanban-board' and 'editor of markdown'
    still lands). Returns ALL candidates — the caller decides whether one
    match is unambiguous enough to retry with.
    """
    want = _normalize_app_id(requested)
    if not want:
        return []
    exact = [a for a in available if _normalize_app_id(a) == want]
    if exact:
        return exact
    return [
        a
        for a in available
        if want in _normalize_app_id(a) or _normalize_app_id(a) in want
    ]


async def _open_app(app_id: str, title: str) -> dict[str, Any]:
    app_id = (app_id or "").strip()
    if not app_id:
        return {"error": "bad_app_id", "detail": "app_id is required"}

    async def attempt(target_id: str) -> dict[str, Any]:
        payload: dict[str, Any] = {"appId": target_id}
        if title:
            payload["title"] = title
        return await mesh_invoke("viewer_desktop.open_app", payload)

    try:
        response = await attempt(app_id)
        # Unknown id: the viewer node returns ok:false with the live
        # registry ids. Fuzzy-resolve and retry once before giving up —
        # the model says 'kanban', the registry says 'kanban-board'.
        if not response.get("ok", False) and isinstance(
            response.get("available"), list
        ):
            available = [a for a in response["available"] if isinstance(a, str)]
            candidates = _fuzzy_match_app(app_id, available)
            if len(candidates) == 1 and candidates[0] != app_id:
                resolved = candidates[0]
                response = await attempt(resolved)
                if response.get("ok", False):
                    return {
                        "ok": True,
                        "app_id": resolved,
                        "resolved_from": app_id,
                        "window_id": response.get("windowId"),
                    }
            return {
                "ok": False,
                "error": "unknown_app",
                "requested": app_id,
                # Multiple candidates: the model picks one and re-calls.
                # None: it gets the full registry, so it can answer
                # 'what CAN I open' truthfully instead of guessing.
                "did_you_mean": candidates or None,
                "available_apps": available,
            }
    except MeshUnavailable as e:
        return {"error": "viewer unavailable", "detail": str(e)}
    return {
        "ok": bool(response.get("ok", False)),
        "app_id": app_id,
        "window_id": response.get("windowId"),
    }


async def _arrange_windows(preset: str) -> dict[str, Any]:
    preset = (preset or "").strip().lower()
    if preset not in LAYOUT_PRESETS:
        return {
            "error": "bad_preset",
            "detail": f"preset must be one of {', '.join(LAYOUT_PRESETS)}",
        }
    try:
        response = await mesh_invoke(
            "viewer_desktop.apply_layout", {"preset": preset}
        )
    except MeshUnavailable as e:
        return {"error": "viewer unavailable", "detail": str(e)}
    return {"ok": bool(response.get("ok", False)), "preset": preset}


async def _list_apps() -> dict[str, Any]:
    try:
        response = await mesh_invoke("viewer_desktop.list_apps", {})
    except MeshUnavailable as e:
        return {"error": "viewer unavailable", "detail": str(e)}
    apps = response.get("apps") or []
    # Project to id + name so the model gets a clean, speakable list.
    slim = [
        {"id": a.get("id"), "name": a.get("name")}
        for a in apps
        if isinstance(a, dict)
    ]
    return {"apps": slim, "count": len(slim)}


async def _list_windows() -> dict[str, Any]:
    try:
        response = await mesh_invoke("viewer_desktop.list_windows", {})
    except MeshUnavailable as e:
        return {"error": "viewer unavailable", "detail": str(e)}
    windows = response.get("windows") or []
    slim = [
        {"window_id": w.get("id"), "app_id": w.get("appId"), "title": w.get("title")}
        for w in windows
        if isinstance(w, dict)
    ]
    return {"windows": slim, "count": len(slim)}


async def _focus_window(window_id: str) -> dict[str, Any]:
    window_id = (window_id or "").strip()
    if not window_id:
        return {"error": "bad_window_id", "detail": "window_id is required"}
    try:
        response = await mesh_invoke("viewer_desktop.focus_window", {"windowId": window_id})
    except MeshUnavailable as e:
        return {"error": "viewer unavailable", "detail": str(e)}
    return {"ok": bool(response.get("ok", False)), "window_id": window_id}


async def _close_window(window_id: str) -> dict[str, Any]:
    window_id = (window_id or "").strip()
    if not window_id:
        return {"error": "bad_window_id", "detail": "window_id is required"}
    try:
        response = await mesh_invoke("viewer_desktop.close_window", {"windowId": window_id})
    except MeshUnavailable as e:
        return {"error": "viewer unavailable", "detail": str(e)}
    return {"ok": bool(response.get("ok", False)), "window_id": window_id}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for the viewer control tools."""
    hints = ", ".join(f"'{a}'" for a in APP_HINTS)
    open_app = types.FunctionDeclaration(
        name="open_app",
        description=(
            "Open an app in a new window on the Viewer desktop. Use when the "
            "user asks to open, show, launch, or pull up an app or view (e.g. "
            "'open the browser', 'pull up a terminal', 'show me my lanes'). "
            f"Common app ids: {hints} — but this is NOT the full set: more "
            "apps exist, and unknown ids are fuzzy-matched against the live "
            "registry automatically. So when the user names ANY app, CALL "
            "THIS TOOL — never claim an app doesn't exist without trying; if "
            "it truly doesn't, the result lists what IS available (use "
            "did_you_mean / available_apps to recover or answer). Returns the "
            "new window_id (use it to focus/close later). A short spoken ack "
            "is enough — there is no content to read."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "app_id": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "App id to open, e.g. 'browser', 'terminal', 'mesh'. "
                        "A close guess is fine — it is fuzzy-resolved."
                    ),
                ),
                "title": types.Schema(
                    type=types.Type.STRING,
                    description="Optional window title; defaults to the app name.",
                ),
            },
            required=["app_id"],
        ),
    )
    arrange_windows = types.FunctionDeclaration(
        name="arrange_windows",
        description=(
            "Arrange the open windows on the Viewer desktop with a layout "
            "preset. Use when the user asks to tile, arrange, organize, "
            "split, or clean up their windows ('tile the windows', 'arrange "
            "everything', 'split these two', 'clean up my desktop' → 'tile'). "
            "Presets: 'tile' (auto-grid every window — the default ask), "
            "'focus' (one large centered window), 'split' (two side by side), "
            "'thirds' (three columns), 'quarters' (2x2 grid). A short spoken "
            "ack is enough."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "preset": types.Schema(
                    type=types.Type.STRING,
                    description="One of: 'tile', 'focus', 'split', 'thirds', 'quarters'.",
                ),
            },
            required=["preset"],
        ),
    )
    list_apps = types.FunctionDeclaration(
        name="list_apps",
        description=(
            "List the apps available to open (id + name). Use when the user "
            "asks what they can open, or to resolve a fuzzy name to an id "
            "before open_app. No parameters."
        ),
        parameters=types.Schema(type=types.Type.OBJECT, properties={}),
    )
    list_windows = types.FunctionDeclaration(
        name="list_windows",
        description=(
            "List the windows currently open on the desktop (window_id, app_id, "
            "title). Use to find a window's id before focusing or closing it. "
            "No parameters."
        ),
        parameters=types.Schema(type=types.Type.OBJECT, properties={}),
    )
    focus_window = types.FunctionDeclaration(
        name="focus_window",
        description=(
            "Bring an already-open window to the front. Takes the window_id "
            "from open_app or list_windows (NOT an app id). If you only know "
            "the app, call list_windows first."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "window_id": types.Schema(
                    type=types.Type.STRING,
                    description="The window's id (from open_app / list_windows).",
                ),
            },
            required=["window_id"],
        ),
    )
    close_window = types.FunctionDeclaration(
        name="close_window",
        description=(
            "Close a window. Takes the window_id from open_app or list_windows "
            "(NOT an app id). A brief ack ('Closed.') is enough."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "window_id": types.Schema(
                    type=types.Type.STRING,
                    description="The window's id (from open_app / list_windows).",
                ),
            },
            required=["window_id"],
        ),
    )
    return [
        types.Tool(
            function_declarations=[
                open_app,
                list_apps,
                list_windows,
                focus_window,
                close_window,
                arrange_windows,
            ]
        )
    ]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "open_app":
        return await _open_app(app_id=str(args.get("app_id", "")), title=str(args.get("title", "")))
    if name == "list_apps":
        return await _list_apps()
    if name == "list_windows":
        return await _list_windows()
    if name == "focus_window":
        return await _focus_window(window_id=str(args.get("window_id", "")))
    if name == "close_window":
        return await _close_window(window_id=str(args.get("window_id", "")))
    if name == "arrange_windows":
        return await _arrange_windows(preset=str(args.get("preset", "")))
    return None
