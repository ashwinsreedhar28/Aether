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
]

# Built-in Aether apps the model can open by id without first calling list_apps.
BUILTIN_APPS = ("mesh", "lanes", "gaps", "terminal", "calculator", "settings")


async def _open_app(app_id: str, title: str) -> dict[str, Any]:
    app_id = (app_id or "").strip()
    if not app_id:
        return {"error": "bad_app_id", "detail": "app_id is required"}
    payload: dict[str, Any] = {"appId": app_id}
    if title:
        payload["title"] = title
    try:
        response = await mesh_invoke("viewer_desktop.open_app", payload)
    except MeshUnavailable as e:
        return {"error": "viewer unavailable", "detail": str(e)}
    return {
        "ok": bool(response.get("ok", False)),
        "app_id": app_id,
        "window_id": response.get("windowId"),
    }


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
    builtins = ", ".join(f"'{a}'" for a in BUILTIN_APPS)
    open_app = types.FunctionDeclaration(
        name="open_app",
        description=(
            "Open an app in a new window on the Viewer desktop. Use when the "
            "user asks to open, show, launch, or pull up an app or view (e.g. "
            "'open the mesh', 'show me my lanes', 'pull up a terminal', 'open "
            f"the gaps'). Built-in apps: {builtins}. Call list_apps first if "
            "unsure of the id. Returns the new window_id (use it to focus/close "
            "later). A short spoken ack is enough — there is no content to read."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "app_id": types.Schema(
                    type=types.Type.STRING,
                    description="App id to open, e.g. 'mesh', 'lanes', 'gaps', 'terminal'.",
                ),
                "title": types.Schema(
                    type=types.Type.STRING,
                    description="Optional window title; defaults to the app name.",
                ),
            },
            required=["app_id"],
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
    return None
