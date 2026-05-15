"""Reminders Tool - macOS Reminders.app readbacks via the mesh.

Three tools, all routed through ``mesh_invoke`` to the reminders node:

  - ``reminders_due_today()``       → ``reminders.due_today()``
  - ``reminders_overdue()``         → ``reminders.overdue()``
  - ``reminders_upcoming(limit?)``  → ``reminders.upcoming(limit)``

Pattern matches calendar_tool / news_tool / finance_tool: declare the
function for Gemini, implement as a thin ``await mesh_invoke(...)``,
add edges in manifest.yaml. The reminders node returns natural data
(title / due_date / is_completed / list_name / priority / notes), so
summarisation is minimal — format the list into a natural-language
string and return both structured data and a ``spoken`` field.

On first invocation macOS prompts the user for Reminders access
permission. If the user denies, all surfaces return
{available: false, reason: 'permission_denied'} and the voice tool
hands back a clear "Reminders access denied" message.
"""
from __future__ import annotations

from typing import Any
from datetime import datetime

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["reminders_due_today", "reminders_overdue", "reminders_upcoming"]

DEFAULT_UPCOMING_LIMIT = 10


def _format_reminder(reminder: dict[str, Any]) -> str:
    """Format a single reminder into a natural-language line."""
    title = reminder.get("title", "Untitled")
    due_iso = reminder.get("due_date")
    list_name = reminder.get("list_name")

    parts = [title]

    if due_iso:
        try:
            due_dt = datetime.fromisoformat(due_iso.replace("Z", "+00:00"))
            due_str = due_dt.strftime("%-I:%M %p")
            parts.append(f"due {due_str}")
        except (ValueError, AttributeError):
            pass

    if list_name and list_name != "Reminders":
        parts.append(f"({list_name})")

    return ", ".join(parts)


async def _reminders_due_today() -> dict[str, Any]:
    """Fetch reminders due today."""
    try:
        response = await mesh_invoke("reminders.due_today", {})
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    if not isinstance(response, dict):
        return {"error": "malformed response"}

    available = response.get("available", False)
    if not available:
        reason = response.get("reason", "unknown")
        if reason == "permission_denied":
            return {
                "error": "permission_denied",
                "spoken": "Reminders access isn't authorized yet, sir. Please grant permission in System Settings."
            }
        if reason == "framework_unavailable":
            return {
                "error": "unavailable",
                "spoken": "Reminders integration isn't available on this platform."
            }
        return {"error": "unavailable", "detail": reason}

    reminders = response.get("reminders", [])
    if not reminders:
        return {"reminders": [], "spoken": "Nothing due today, sir."}

    lines = [_format_reminder(r) for r in reminders]
    count = len(lines)
    spoken = f"You have {count} {'reminder' if count == 1 else 'reminders'} due today, sir: " + "; ".join(lines)

    return {"reminders": reminders, "count": count, "spoken": spoken}


async def _reminders_overdue() -> dict[str, Any]:
    """Fetch overdue reminders (past due, still incomplete)."""
    try:
        response = await mesh_invoke("reminders.overdue", {})
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    if not isinstance(response, dict):
        return {"error": "malformed response"}

    available = response.get("available", False)
    if not available:
        reason = response.get("reason", "unknown")
        if reason == "permission_denied":
            return {
                "error": "permission_denied",
                "spoken": "Reminders access isn't authorized yet, sir. Please grant permission in System Settings."
            }
        if reason == "framework_unavailable":
            return {
                "error": "unavailable",
                "spoken": "Reminders integration isn't available on this platform."
            }
        return {"error": "unavailable", "detail": reason}

    reminders = response.get("reminders", [])
    if not reminders:
        return {"reminders": [], "spoken": "Nothing overdue, sir."}

    lines = [_format_reminder(r) for r in reminders]
    count = len(lines)
    spoken = f"You have {count} overdue {'reminder' if count == 1 else 'reminders'}, sir: " + "; ".join(lines)

    return {"reminders": reminders, "count": count, "spoken": spoken}


async def _reminders_upcoming(limit: int) -> dict[str, Any]:
    """Fetch next N upcoming reminders."""
    clamped_limit = max(1, min(limit, 50))

    try:
        response = await mesh_invoke("reminders.upcoming", {"limit": clamped_limit})
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    if not isinstance(response, dict):
        return {"error": "malformed response"}

    available = response.get("available", False)
    if not available:
        reason = response.get("reason", "unknown")
        if reason == "permission_denied":
            return {
                "error": "permission_denied",
                "spoken": "Reminders access isn't authorized yet, sir. Please grant permission in System Settings."
            }
        if reason == "framework_unavailable":
            return {
                "error": "unavailable",
                "spoken": "Reminders integration isn't available on this platform."
            }
        return {"error": "unavailable", "detail": reason}

    reminders = response.get("reminders", [])
    if not reminders:
        return {"reminders": [], "spoken": "No upcoming reminders, sir."}

    lines = [_format_reminder(r) for r in reminders]
    count = len(lines)
    spoken = f"Your next {count} {'reminder' if count == 1 else 'reminders'}: " + "; ".join(lines)

    return {"reminders": reminders, "count": count, "spoken": spoken}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for all reminders tools."""
    due_today_func = types.FunctionDeclaration(
        name="reminders_due_today",
        description=(
            "Get reminders due today from macOS Reminders.app (incomplete only). "
            "Use when the user asks 'what's due today', 'reminders due today', "
            "'do I have anything due'. Returns a list of reminders (title, "
            "due_date, list_name, priority). On first invocation, macOS prompts "
            "the user for Reminders access permission. If nothing is due today, "
            "returns a spoken 'nothing due' message. Read the spoken field verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},
        ),
    )

    overdue_func = types.FunctionDeclaration(
        name="reminders_overdue",
        description=(
            "Get overdue reminders from macOS Reminders.app (past due date, "
            "still incomplete). Use when the user asks 'what's overdue', "
            "'do I have any overdue reminders', 'am I behind'. Returns a list "
            "of reminders past their due date. On first invocation, macOS "
            "prompts the user for Reminders access permission. If nothing is "
            "overdue, returns a spoken 'nothing overdue' message. Read the "
            "spoken field verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},
        ),
    )

    upcoming_func = types.FunctionDeclaration(
        name="reminders_upcoming",
        description=(
            "Get next N upcoming reminders from macOS Reminders.app, sorted "
            "by due date. Use when the user asks 'what's coming up in my "
            "reminders', 'next reminders', 'upcoming reminders'. Default "
            "limit is 10, max 50. On first invocation, macOS prompts the "
            "user for Reminders access permission. If no upcoming reminders "
            "exist, returns a spoken 'no upcoming' message. Read the spoken "
            "field verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "limit": types.Schema(
                    type=types.Type.INTEGER,
                    description=(
                        "Optional number of upcoming reminders to return. "
                        "Default 10, clamped to 1-50. Map natural phrasing: "
                        "'next few' → 5, 'next ten' → 10, etc."
                    ),
                ),
            },
            required=[],
        ),
    )

    return [
        types.Tool(
            function_declarations=[due_today_func, overdue_func, upcoming_func]
        )
    ]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "reminders_due_today":
        return await _reminders_due_today()
    if name == "reminders_overdue":
        return await _reminders_overdue()
    if name == "reminders_upcoming":
        limit = args.get("limit", DEFAULT_UPCOMING_LIMIT)
        if not isinstance(limit, int):
            limit = DEFAULT_UPCOMING_LIMIT
        return await _reminders_upcoming(limit)
    return None
