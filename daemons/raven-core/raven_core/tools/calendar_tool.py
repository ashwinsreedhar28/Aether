"""Calendar Tool - macOS Calendar.app event readbacks via the mesh.

Three tools, all routed through ``mesh_invoke`` to the calendar node:

  - ``calendar_today()``              → ``calendar.today()``
  - ``calendar_next()``               → ``calendar.next_event()``
  - ``calendar_upcoming(limit?)``     → ``calendar.upcoming(limit)``

Pattern matches news_tool / finance_tool: declare the function for
Gemini, implement as a thin ``await mesh_invoke(...)``, add edges in
manifest.yaml. The calendar node already returns natural data
(title / start / end / location / notes), so summarisation is minimal
— just format the event list into a natural-language string and
return both the structured data and a ``spoken`` field.

On first invocation macOS prompts the user for Calendar access
permission. If the user denies, all surfaces return
{available: false, reason: 'permission_denied'} and the voice tool
hands back a clear "Calendar access denied" message.
"""
from __future__ import annotations

from typing import Any
from datetime import datetime

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["calendar_today", "calendar_next", "calendar_upcoming"]

DEFAULT_UPCOMING_LIMIT = 5


def _format_event(event: dict[str, Any]) -> str:
    """Format a single event into a natural-language line.

    Example: "Team standup, 10:00 AM to 10:30 AM, Zoom"
    """
    title = event.get("title", "Untitled")
    start_iso = event.get("start", "")
    end_iso = event.get("end", "")
    location = event.get("location", "")
    is_all_day = event.get("is_all_day", False)

    if is_all_day:
        time_str = "all day"
    else:
        try:
            start_dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
            end_dt = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
            start_time = start_dt.strftime("%-I:%M %p")
            end_time = end_dt.strftime("%-I:%M %p")
            time_str = f"{start_time} to {end_time}"
        except (ValueError, AttributeError):
            time_str = "time unknown"

    parts = [title, time_str]
    if location:
        parts.append(location)

    return ", ".join(parts)


async def _calendar_today() -> dict[str, Any]:
    """Fetch all events on today's date."""
    try:
        response = await mesh_invoke("calendar.today", {})
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
                "spoken": "Calendar access isn't authorized yet, sir. Please grant permission in System Settings."
            }
        if reason == "no_events":
            return {
                "events": [],
                "spoken": "No events on your calendar today, sir."
            }
        if reason == "framework_unavailable":
            return {
                "error": "unavailable",
                "spoken": "Calendar integration isn't available on this platform."
            }
        return {"error": "unavailable", "detail": reason}

    events = response.get("events", [])
    if not events:
        return {"events": [], "spoken": "No events on your calendar today, sir."}

    # Format each event into a natural-language line
    lines = [_format_event(e) for e in events]
    count = len(lines)
    spoken = f"You have {count} {'event' if count == 1 else 'events'} today, sir: " + "; ".join(lines)

    return {"events": events, "count": count, "spoken": spoken}


async def _calendar_next() -> dict[str, Any]:
    """Fetch single next upcoming event."""
    try:
        response = await mesh_invoke("calendar.next_event", {})
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
                "spoken": "Calendar access isn't authorized yet, sir. Please grant permission in System Settings."
            }
        if reason == "no_events":
            return {
                "event": None,
                "spoken": "No upcoming events on your calendar, sir."
            }
        if reason == "framework_unavailable":
            return {
                "error": "unavailable",
                "spoken": "Calendar integration isn't available on this platform."
            }
        return {"error": "unavailable", "detail": reason}

    events = response.get("events", [])
    if not events:
        return {"event": None, "spoken": "No upcoming events on your calendar, sir."}

    event = events[0]
    spoken = f"Your next event is: {_format_event(event)}"

    return {"event": event, "spoken": spoken}


async def _calendar_upcoming(limit: int) -> dict[str, Any]:
    """Fetch next N events from now."""
    # Clamp to 1-20
    clamped_limit = max(1, min(limit, 20))

    try:
        response = await mesh_invoke("calendar.upcoming", {"limit": clamped_limit})
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
                "spoken": "Calendar access isn't authorized yet, sir. Please grant permission in System Settings."
            }
        if reason == "no_events":
            return {
                "events": [],
                "spoken": "No upcoming events on your calendar, sir."
            }
        if reason == "framework_unavailable":
            return {
                "error": "unavailable",
                "spoken": "Calendar integration isn't available on this platform."
            }
        return {"error": "unavailable", "detail": reason}

    events = response.get("events", [])
    if not events:
        return {"events": [], "spoken": "No upcoming events on your calendar, sir."}

    # Format each event into a natural-language line
    lines = [_format_event(e) for e in events]
    count = len(lines)
    spoken = f"Your next {count} {'event' if count == 1 else 'events'}: " + "; ".join(lines)

    return {"events": events, "count": count, "spoken": spoken}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for all calendar tools."""
    today_func = types.FunctionDeclaration(
        name="calendar_today",
        description=(
            "Get all events on today's date from macOS Calendar.app. "
            "Use when the user asks 'what's on my calendar today', "
            "'what do I have today', 'today's schedule'. Returns a "
            "list of events (title, start, end, location) sorted by "
            "start time. On first invocation, macOS prompts the user "
            "for Calendar access permission. If no events exist today, "
            "returns a spoken 'no events' message. Read the spoken "
            "field verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},
        ),
    )

    next_func = types.FunctionDeclaration(
        name="calendar_next",
        description=(
            "Get the single next upcoming event from macOS Calendar.app. "
            "Use when the user asks 'what's my next event', 'what's "
            "next on my calendar', 'when's my next meeting'. Returns "
            "a single event (title, start, end, location). On first "
            "invocation, macOS prompts the user for Calendar access "
            "permission. If no upcoming events exist, returns a spoken "
            "'no events' message. Read the spoken field verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},
        ),
    )

    upcoming_func = types.FunctionDeclaration(
        name="calendar_upcoming",
        description=(
            "Get the next N upcoming events from macOS Calendar.app. "
            "Use when the user asks 'what's coming up on my calendar', "
            "'next five things on my schedule', 'upcoming events'. "
            "Returns events sorted by start time. Default limit is 5, "
            "max 20. On first invocation, macOS prompts the user for "
            "Calendar access permission. If no upcoming events exist, "
            "returns a spoken 'no events' message. Read the spoken "
            "field verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "limit": types.Schema(
                    type=types.Type.INTEGER,
                    description=(
                        "Optional number of upcoming events to return. "
                        "Default 5, clamped to 1-20. Map natural phrasing: "
                        "'next few' → 5, 'next ten' → 10, etc."
                    ),
                ),
            },
            required=[],
        ),
    )

    return [
        types.Tool(
            function_declarations=[today_func, next_func, upcoming_func]
        )
    ]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "calendar_today":
        return await _calendar_today()
    if name == "calendar_next":
        return await _calendar_next()
    if name == "calendar_upcoming":
        limit = args.get("limit", DEFAULT_UPCOMING_LIMIT)
        if not isinstance(limit, int):
            limit = DEFAULT_UPCOMING_LIMIT
        return await _calendar_upcoming(limit)
    return None
