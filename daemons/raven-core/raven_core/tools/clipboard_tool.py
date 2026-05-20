"""Clipboard Tool - macOS clipboard history readbacks via the mesh.

One tool, routed through ``mesh_invoke`` to the clipboard_history node:

  - ``clipboard_recent(limit?)``  → ``clipboard_history.recent(limit)``

Pattern matches calendar_tool / system_info_tool: declare the function
for Gemini, implement as a thin ``await mesh_invoke(...)``, add edges
in manifest.yaml. The clipboard_history node polls the macOS clipboard
at 500ms intervals and persists entries to SQLite.

No special permission required — the clipboard is freely readable from
the user's session.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["clipboard_recent"]

DEFAULT_LIMIT = 5
PREVIEW_CHARS = 80


def _format_preview(content: str) -> str:
    """Truncate clipboard content to a speakable preview."""
    if not content:
        return "(empty)"
    flat = " ".join(content.split())
    if len(flat) <= PREVIEW_CHARS:
        return flat
    return flat[:PREVIEW_CHARS].rstrip() + "..."


async def _clipboard_recent(limit: int) -> dict[str, Any]:
    """Fetch the most recent clipboard entries."""
    clamped = max(1, min(limit, 50))

    try:
        response = await mesh_invoke("clipboard_history.recent", {"limit": clamped})
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    if not isinstance(response, dict):
        return {"error": "malformed response"}

    entries = response.get("entries", [])
    if not entries:
        return {
            "entries": [],
            "spoken": "Nothing in your clipboard history yet, sir.",
        }

    count = len(entries)
    latest = entries[0]
    preview = _format_preview(latest.get("content", ""))

    if count == 1:
        spoken = f"Your most recent clipboard entry, sir: {preview}"
    else:
        spoken = (
            f"You have {count} recent clipboard entries, sir. "
            f"The latest: {preview}"
        )

    return {"entries": entries, "count": count, "spoken": spoken}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for clipboard tools."""
    recent_func = types.FunctionDeclaration(
        name="clipboard_recent",
        description=(
            "Get the most recent entries from the user's clipboard history. "
            "Use when the user asks 'what's on my clipboard', 'what did I "
            "just copy', 'show me my clipboard history', 'what was that "
            "thing I copied'. Returns the latest N entries with content "
            "preview and timestamps. Default limit is 5, max 50. The "
            "clipboard_history node polls macOS at 500ms so the latest "
            "entry is always recent. Read the spoken field verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "limit": types.Schema(
                    type=types.Type.INTEGER,
                    description=(
                        "Optional number of recent clipboard entries to "
                        "return. Default 5, clamped to 1-50."
                    ),
                ),
            },
            required=[],
        ),
    )

    return [types.Tool(function_declarations=[recent_func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "clipboard_recent":
        limit = args.get("limit", DEFAULT_LIMIT)
        if not isinstance(limit, int):
            limit = DEFAULT_LIMIT
        return await _clipboard_recent(limit)
    return None
