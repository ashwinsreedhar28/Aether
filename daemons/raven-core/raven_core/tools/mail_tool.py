"""Mail Tool - macOS Mail.app readbacks + open via the mesh.

Two tools, routed through ``mesh_invoke`` to the macos_mail node:

  - ``mail_recent(limit?, unread_only?)``  → ``macos_mail.recent(...)``
      A LIST/summary of recent inbox messages (sender + subject lines).
  - ``mail_open_latest()``                 → ``macos_mail.recent(limit=1)``
      then ``macos_mail.open_message(id)`` — pulls the newest message UP in
      Mail.app and speaks ONE summary line. Never narrates a full body.

The headline behaviour is "pull the email up," not "read it aloud":
``open_message`` opens the message via the ``message://`` URL scheme
(LaunchServices), which stays responsive even when Mail's AppleScript
interface is degraded. Body capture still happens in the node (non-blocking)
and feeds the optional one-line gist when available.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["mail_recent", "mail_open_latest"]

DEFAULT_LIMIT = 5
PREVIEW_CHARS = 80
# Max characters of body gist spoken on open. A taste, never the full body.
GIST_CHARS = 140


def _format_mail_line(message: dict[str, Any]) -> str:
    """Format a single mail message into a natural-language summary line."""
    sender = message.get("from") or message.get("sender") or "unknown"
    subject = message.get("subject", "(no subject)")
    if len(subject) > PREVIEW_CHARS:
        subject = subject[:PREVIEW_CHARS].rstrip() + "..."
    return f"{sender}: {subject}"


def _format_open_line(message: dict[str, Any]) -> str:
    """One spoken line for opening a message: sender + subject, plus a short
    gist ONLY if a body was captured. Never the full body — this pulls the
    message up on screen, it does not narrate it."""
    sender = message.get("from") or message.get("sender") or "unknown"
    subject = message.get("subject", "(no subject)")
    line = f"From {sender}. Subject: {subject}."
    body = message.get("body")
    if body:
        gist = " ".join(str(body).split())[:GIST_CHARS].rstrip()
        if gist:
            line += f" It begins: {gist}…"
    return line


async def _mail_recent(limit: int, unread_only: bool) -> dict[str, Any]:
    """Fetch a summary list of recent mail messages."""
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


async def _mail_open_latest() -> dict[str, Any]:
    """Open the user's most recent email in Mail.app; return one spoken line."""
    try:
        response = await mesh_invoke(
            "macos_mail.recent", {"limit": 1, "unread_only": False}
        )
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    if not isinstance(response, dict):
        return {"error": "malformed response"}

    messages = response.get("messages", [])
    if not messages:
        return {"messages": [], "spoken": "No recent mail to open, sir."}

    msg = messages[0]
    message_id = msg.get("uid") or msg.get("id")
    line = _format_open_line(msg)

    if not message_id:
        # We can still say what it is, but can't pull it up without an id.
        return {"error": "no_message_id", "spoken": line}

    try:
        await mesh_invoke("macos_mail.open_message", {"id": message_id})
    except MeshUnavailable as e:
        return {
            "error": "open_failed",
            "detail": str(e),
            "spoken": line + " I couldn't pull it up in Mail, sir.",
        }

    return {"opened": True, "spoken": line}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for mail tools."""
    recent_func = types.FunctionDeclaration(
        name="mail_recent",
        description=(
            "Get a LIST/summary of recent mail messages from macOS Mail.app. "
            "Use when the user asks 'any new mail', 'check my mail', 'do I "
            "have unread email', 'what's in my inbox', 'recent emails'. "
            "Returns the latest N messages (from + subject; a body may also be "
            "present). Default limit 5, max 50. Set unread_only true for "
            "unread-only queries. Read the spoken field verbatim. To OPEN / "
            "pull up a specific (latest) email, use mail_open_latest instead — "
            "do NOT narrate full bodies."
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

    open_func = types.FunctionDeclaration(
        name="mail_open_latest",
        description=(
            "Open (pull up) the user's most recent email in macOS Mail.app and "
            "speak ONE summary line. Use for 'read / show / open / pull up my "
            "latest email', 'open my most recent email'. Brings Mail.app to "
            "the message via the message:// URL — works even when Mail is slow "
            "to script. Returns a `spoken` field with a single line (sender + "
            "subject, plus a short gist only if a body was captured). Read the "
            "spoken field verbatim; do NOT read a full email body aloud and do "
            "NOT enumerate — this pulls the message up, it does not narrate it."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},
            required=[],
        ),
    )

    return [types.Tool(function_declarations=[recent_func, open_func])]


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
    if name == "mail_open_latest":
        return await _mail_open_latest()
    return None
