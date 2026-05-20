"""Mail Tool - macOS Mail.app readbacks via the mesh.

One tool, routed through ``mesh_invoke`` to the macos_mail node:

  - ``mail_recent(limit?, unread_only?)``  → ``macos_mail.recent(...)``

Pattern matches calendar_tool / messages_tool: declare the function
for Gemini, implement as a thin ``await mesh_invoke(...)``, add edges
in manifest.yaml. The macos_mail node bridges to Mail.app via the
@aether/macos-applescript bridge primitive, which requires:
  - Automation permission for the Aether shell (System Events → Mail)
  - Mail.app to be running

If Automation isn't granted, the surface returns
reason='permission_denied'. If Mail.app isn't open or AppleScript
times out (-1741), the surface returns reason='timeout' or
'app_not_running'. This tool surfaces both gracefully.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["mail_recent"]

DEFAULT_LIMIT = 5
PREVIEW_CHARS = 80


def _format_mail_line(message: dict[str, Any]) -> str:
    """Format a single mail message into a natural-language line."""
    sender = message.get("from") or message.get("sender") or "unknown"
    subject = message.get("subject", "(no subject)")
    if len(subject) > PREVIEW_CHARS:
        subject = subject[:PREVIEW_CHARS].rstrip() + "..."
    return f"{sender}: {subject}"


async def _mail_recent(limit: int, unread_only: bool) -> dict[str, Any]:
    """Fetch recent mail messages."""
    clamped = max(1, min(limit, 50))

    try:
        response = await mesh_invoke(
            "macos_mail.recent",
            {"limit": clamped, "unread_only": unread_only},
        )
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
                    "I can't read mail, sir. The Aether shell needs "
                    "Automation access for Mail.app. Grant it in System "
                    "Settings, Privacy and Security, Automation, under "
                    "the Aether shell entry."
                ),
            }
        if reason in ("app_not_running", "timeout"):
            return {
                "error": "app_unavailable",
                "spoken": (
                    "Mail.app isn't responding, sir. Make sure it's open "
                    "and try again."
                ),
            }
        return {
            "error": "unavailable",
            "spoken": "Mail isn't available right now, sir.",
            "detail": reason,
        }

    messages = response.get("messages", [])
    if not messages:
        descriptor = "unread mail" if unread_only else "mail"
        return {
            "messages": [],
            "spoken": f"No recent {descriptor}, sir.",
        }

    count = len(messages)
    lines = [_format_mail_line(m) for m in messages[:3]]

    descriptor = "unread" if unread_only else "recent"
    if count == 1:
        spoken = f"One {descriptor} message, sir. {lines[0]}"
    elif count <= 3:
        spoken = f"{count} {descriptor} messages, sir. " + "; ".join(lines)
    else:
        spoken = (
            f"{count} {descriptor} messages, sir. The top three: "
            + "; ".join(lines)
        )

    return {"messages": messages, "count": count, "spoken": spoken}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for mail tools."""
    recent_func = types.FunctionDeclaration(
        name="mail_recent",
        description=(
            "Get recent mail messages from macOS Mail.app. Use when the "
            "user asks 'any new mail', 'check my mail', 'do I have "
            "unread email', 'what's in my inbox', 'recent emails'. "
            "Returns the latest N messages with from and subject. "
            "Default limit is 5, max 50. Set unread_only to true for "
            "unread-only queries. Requires Automation permission for "
            "Mail.app and Mail.app to be running. If permission missing "
            "or app not responding, returns a spoken message explaining "
            "what to do. Read the spoken field verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "limit": types.Schema(
                    type=types.Type.INTEGER,
                    description=(
                        "Optional number of recent mail messages to "
                        "return. Default 5, clamped to 1-50."
                    ),
                ),
                "unread_only": types.Schema(
                    type=types.Type.BOOLEAN,
                    description=(
                        "If true, return only unread messages. "
                        "Default false."
                    ),
                ),
            },
            required=[],
        ),
    )

    return [types.Tool(function_declarations=[recent_func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "mail_recent":
        limit = args.get("limit", DEFAULT_LIMIT)
        if not isinstance(limit, int):
            limit = DEFAULT_LIMIT
        unread_only = args.get("unread_only", False)
        if not isinstance(unread_only, bool):
            unread_only = False
        return await _mail_recent(limit, unread_only)
    return None
