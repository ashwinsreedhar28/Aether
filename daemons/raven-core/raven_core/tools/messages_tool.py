"""Messages Tool - macOS Messages (iMessage) readbacks via the mesh.

One tool, routed through ``mesh_invoke`` to the macos_messages node:

  - ``messages_recent(limit?)``  → ``macos_messages.recent(limit)``

Pattern matches calendar_tool / clipboard_tool: declare the function
for Gemini, implement as a thin ``await mesh_invoke(...)``, add edges
in manifest.yaml. The macos_messages node reads from
~/Library/Messages/chat.db, which requires Full Disk Access for the
Aether shell process.

On first invocation, if FDA isn't granted, the surface returns
{available: false, reason: 'permission_denied'} and this tool hands
back a clear "needs Full Disk Access" message.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["messages_recent"]

DEFAULT_LIMIT = 5
PREVIEW_CHARS = 80


def _format_message_line(message: dict[str, Any]) -> str:
    """Format a single message into a natural-language line."""
    sender = message.get("sender") or message.get("handle") or "unknown"
    text = message.get("text", "")
    if not text:
        return f"{sender}: (attachment)"
    text = " ".join(text.split())
    if len(text) > PREVIEW_CHARS:
        text = text[:PREVIEW_CHARS].rstrip() + "..."
    return f"{sender}: {text}"


async def _messages_recent(limit: int) -> dict[str, Any]:
    """Fetch recent iMessages."""
    clamped = max(1, min(limit, 50))

    try:
        response = await mesh_invoke("macos_messages.recent", {"limit": clamped})
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    if not isinstance(response, dict):
        return {"error": "malformed response"}

    available = response.get("available", True)
    if not available:
        reason = response.get("reason", "unknown")
        if reason == "permission_denied":
            return {
                "error": "permission_denied",
                "spoken": (
                    "I can't read messages, sir. The Aether shell needs Full "
                    "Disk Access. Grant it in System Settings, Privacy and "
                    "Security, Full Disk Access."
                ),
            }
        return {
            "error": "unavailable",
            "spoken": "Messages aren't available right now, sir.",
            "detail": reason,
        }

    messages = response.get("messages", [])
    if not messages:
        return {
            "messages": [],
            "spoken": "No recent messages, sir.",
        }

    count = len(messages)
    lines = [_format_message_line(m) for m in messages[:3]]

    if count == 1:
        spoken = f"One recent message, sir. {lines[0]}"
    elif count <= 3:
        spoken = f"{count} recent messages, sir. " + "; ".join(lines)
    else:
        spoken = (
            f"{count} recent messages, sir. The latest three: "
            + "; ".join(lines)
        )

    return {"messages": messages, "count": count, "spoken": spoken}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for messages tools."""
    recent_func = types.FunctionDeclaration(
        name="messages_recent",
        description=(
            "Get recent iMessages and SMS messages from macOS Messages app. "
            "Use when the user asks 'any new messages', 'did anyone text me', "
            "'what did X text me', 'recent messages'. Returns the latest N "
            "messages with sender and text preview. Default limit is 5, max "
            "50. Requires Full Disk Access for the Aether shell. If not "
            "granted, returns a spoken message asking the user to enable "
            "FDA. Read the spoken field verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "limit": types.Schema(
                    type=types.Type.INTEGER,
                    description=(
                        "Optional number of recent messages to return. "
                        "Default 5, clamped to 1-50."
                    ),
                ),
            },
            required=[],
        ),
    )

    return [types.Tool(function_declarations=[recent_func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "messages_recent":
        limit = args.get("limit", DEFAULT_LIMIT)
        if not isinstance(limit, int):
            limit = DEFAULT_LIMIT
        return await _messages_recent(limit)
    return None
