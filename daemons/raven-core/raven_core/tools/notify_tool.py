"""Notify Tool - Fire a native desktop notification via the mesh.

This is raven's first mesh-routed tool. The implementation invokes
``host_notifications.notify`` through ``mesh_client.mesh_invoke`` rather
than running any notification code itself. The edge
``raven → host_notifications.notify`` in manifest.yaml authorises the
hop; without it Core would reject the envelope.

Pattern for every future voice tool that touches Aether data or
capabilities: declare the function here, implement as a single
``await mesh_invoke(...)``, add the edge to manifest.yaml. Tools
internal to raven (time, memory) stay direct Python — they're not
Aether data and don't need to leave the daemon.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["notify"]

# Mirrors nodes/host_notifications/schemas/notify.json bounds (200 / 1000)
# but slightly tighter — Gemini's spoken titles/bodies are short, and
# truncating here is cleaner than a noisy MeshDeny from the schema
# validator on the host_notifications side.
TITLE_MAX = 128
BODY_MAX = 512


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


async def _notify(title: str, body: str) -> dict[str, Any]:
    title = _truncate(title or "Aether", TITLE_MAX)
    body = _truncate(body or "", BODY_MAX)

    try:
        response = await mesh_invoke(
            "host_notifications.notify",
            {"title": title, "body": body},
        )
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    # host_notifications returns { delivered: bool, at: <iso> } on success.
    return {
        "delivered": bool(response.get("delivered", False)),
        "at": response.get("at"),
        "title": title,
        "body": body,
    }


def get_tools() -> list[types.Tool]:
    """Return Gemini function declaration for notify."""
    func = types.FunctionDeclaration(
        name="notify",
        description=(
            "Send a desktop notification with a short title and body. "
            "Use when the user asks to be notified, reminded, or alerted "
            "about something. Returns immediately; the notification "
            "appears on the user's screen. Title is shown in bold, body "
            "below it. Keep both short (titles under 60 chars read best)."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "title": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        f"Headline of the notification. Max {TITLE_MAX} "
                        "characters; longer titles are truncated."
                    ),
                ),
                "body": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        f"Body text of the notification. Max {BODY_MAX} "
                        "characters; longer bodies are truncated."
                    ),
                ),
            },
            required=["title", "body"],
        ),
    )
    return [types.Tool(function_declarations=[func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "notify":
        return await _notify(
            title=args.get("title", ""),
            body=args.get("body", ""),
        )
    return None
