#!/usr/bin/env python3
"""macOS Calendar mesh node.

Reads events from macOS Calendar.app via EventKit. Four surfaces:
- calendar.today: all events on today's date
- calendar.upcoming: next N events from now (default 5, max 20)
- calendar.next_event: single next upcoming event
- calendar.get_week: all events in the 7-day window from a given date

Sprint 2 data-breadth lane; get_week added in the calendar-weekly-view lane.
"""

import asyncio
import logging
import os
import sys
from datetime import datetime, timedelta
from typing import Any

# Add core SDK to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../core"))

from node_sdk import MeshNode

# macOS framework imports
try:
    import objc
    from Foundation import NSDate, NSCalendar, NSCalendarUnitDay
    from EventKit import (
        EKEventStore,
        EKEntityTypeEvent,
        EKAuthorizationStatusAuthorized,
    )

    AVAILABLE = True
except ImportError:
    AVAILABLE = False

log = logging.getLogger("calendar")
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)


def ns_date_from_python(dt: datetime) -> Any:
    """Convert Python datetime to NSDate."""
    timestamp = dt.timestamp()
    return NSDate.dateWithTimeIntervalSince1970_(timestamp)


def python_date_from_ns(ns_date: Any) -> datetime:
    """Convert NSDate to Python datetime in the SYSTEM-LOCAL zone.

    Times are ALWAYS local — datetime.fromtimestamp() (no tz arg) renders in
    the machine's zone, matching Calendar.app's default and when the event
    actually lands in the user's day. Do NOT "fix" this to honour each event's
    own EKEvent.timeZone(): that makes an Eastern meeting read 4:30 PM on a
    Pacific machine instead of 1:30 PM, diverging from a local Calendar.app
    (decided by smoke, this lane).
    """
    timestamp = ns_date.timeIntervalSince1970()
    return datetime.fromtimestamp(timestamp)


def format_event(event: Any) -> dict[str, Any]:
    """Format an EKEvent into response shape."""
    start = python_date_from_ns(event.startDate())
    end = python_date_from_ns(event.endDate())

    return {
        "title": str(event.title() or "Untitled"),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "location": str(event.location() or ""),
        "calendar_name": str(event.calendar().title() or ""),
        "is_all_day": bool(event.isAllDay()),
        "notes": str(event.notes() or ""),
    }


async def handle_today(params: dict[str, Any]) -> dict[str, Any]:
    """Fetch events on today's date."""
    if not AVAILABLE:
        return {"available": False, "reason": "framework_unavailable"}

    store = EKEventStore.alloc().init()

    # Request authorization synchronously (macOS prompts user on first access)
    status = EKEventStore.authorizationStatusForEntityType_(EKEntityTypeEvent)
    if status != EKAuthorizationStatusAuthorized:
        # Attempt to request access
        granted = await asyncio.to_thread(
            lambda: store.requestAccessToEntityType_completion_(
                EKEntityTypeEvent, None
            )
        )
        if not granted:
            return {"available": False, "reason": "permission_denied"}

    # Get today's date range (midnight to midnight)
    now = datetime.now()
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)

    start_ns = ns_date_from_python(start_of_day)
    end_ns = ns_date_from_python(end_of_day)

    # Fetch events
    predicate = store.predicateForEventsWithStartDate_endDate_calendars_(
        start_ns, end_ns, None
    )
    ek_events = store.eventsMatchingPredicate_(predicate)

    if not ek_events:
        return {
            "available": False,
            "reason": "no_events",
            "timestamp": int(datetime.now().timestamp() * 1000),
        }

    # Sort by start time
    events = [format_event(e) for e in ek_events]
    events.sort(key=lambda x: x["start"])

    return {
        "available": True,
        "events": events,
        "timestamp": int(datetime.now().timestamp() * 1000),
    }


async def handle_upcoming(params: dict[str, Any]) -> dict[str, Any]:
    """Fetch next N events from now."""
    if not AVAILABLE:
        return {"available": False, "reason": "framework_unavailable"}

    limit = params.get("limit", 5)
    limit = max(1, min(limit, 20))  # Clamp to 1-20

    store = EKEventStore.alloc().init()

    # Check authorization
    status = EKEventStore.authorizationStatusForEntityType_(EKEntityTypeEvent)
    if status != EKAuthorizationStatusAuthorized:
        granted = await asyncio.to_thread(
            lambda: store.requestAccessToEntityType_completion_(
                EKEntityTypeEvent, None
            )
        )
        if not granted:
            return {"available": False, "reason": "permission_denied"}

    # Fetch events from now to 1 year ahead (generous window)
    now = datetime.now()
    end = now + timedelta(days=365)

    start_ns = ns_date_from_python(now)
    end_ns = ns_date_from_python(end)

    predicate = store.predicateForEventsWithStartDate_endDate_calendars_(
        start_ns, end_ns, None
    )
    ek_events = store.eventsMatchingPredicate_(predicate)

    if not ek_events:
        return {
            "available": False,
            "reason": "no_events",
            "timestamp": int(datetime.now().timestamp() * 1000),
        }

    # Sort by start time and take first N
    events = [format_event(e) for e in ek_events]
    events.sort(key=lambda x: x["start"])
    events = events[:limit]

    return {
        "available": True,
        "events": events,
        "timestamp": int(datetime.now().timestamp() * 1000),
    }


async def handle_next_event(params: dict[str, Any]) -> dict[str, Any]:
    """Fetch single next upcoming event."""
    if not AVAILABLE:
        return {"available": False, "reason": "framework_unavailable"}

    store = EKEventStore.alloc().init()

    # Check authorization
    status = EKEventStore.authorizationStatusForEntityType_(EKEntityTypeEvent)
    if status != EKAuthorizationStatusAuthorized:
        granted = await asyncio.to_thread(
            lambda: store.requestAccessToEntityType_completion_(
                EKEntityTypeEvent, None
            )
        )
        if not granted:
            return {"available": False, "reason": "permission_denied"}

    # Fetch events from now to 1 year ahead
    now = datetime.now()
    end = now + timedelta(days=365)

    start_ns = ns_date_from_python(now)
    end_ns = ns_date_from_python(end)

    predicate = store.predicateForEventsWithStartDate_endDate_calendars_(
        start_ns, end_ns, None
    )
    ek_events = store.eventsMatchingPredicate_(predicate)

    if not ek_events:
        return {
            "available": False,
            "reason": "no_events",
            "timestamp": int(datetime.now().timestamp() * 1000),
        }

    # Sort by start time and take first
    events = [format_event(e) for e in ek_events]
    events.sort(key=lambda x: x["start"])

    return {
        "available": True,
        "events": [events[0]],
        "timestamp": int(datetime.now().timestamp() * 1000),
    }


def _start_of_day(dt: datetime) -> datetime:
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _parse_week_start(date_str: Any) -> datetime:
    """Resolve the week-window start (local midnight) from the date param.

    Accepts an ISO date ('2026-06-08') or a full ISO datetime; normalises to
    that day's local midnight. A tz-aware value is converted to the system
    zone first, matching python_date_from_ns()'s local-zone rendering (see
    its docstring). Empty / unparseable → today's local midnight, so a bare
    calendar.get_week() means 'the next seven days'.
    """
    if not date_str:
        return _start_of_day(datetime.now())
    try:
        parsed = datetime.fromisoformat(str(date_str).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return _start_of_day(datetime.now())
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    return _start_of_day(parsed)


async def handle_week(params: dict[str, Any]) -> dict[str, Any]:
    """Fetch all events in the 7-day window starting at the given date.

    The window is [date 00:00 local, date + 7 days). The caller supplies the
    week-start date; the calendar_get_week voice tool aligns it to a Monday
    (ISO-8601 week start), but the node itself just returns seven days from
    whatever date it is handed — it imposes no week boundary of its own.
    Omitting date defaults to today, i.e. the next seven days.
    """
    if not AVAILABLE:
        return {"available": False, "reason": "framework_unavailable"}

    store = EKEventStore.alloc().init()

    # Check authorization
    status = EKEventStore.authorizationStatusForEntityType_(EKEntityTypeEvent)
    if status != EKAuthorizationStatusAuthorized:
        granted = await asyncio.to_thread(
            lambda: store.requestAccessToEntityType_completion_(
                EKEntityTypeEvent, None
            )
        )
        if not granted:
            return {"available": False, "reason": "permission_denied"}

    start = _parse_week_start(params.get("date"))
    end = start + timedelta(days=7)

    start_ns = ns_date_from_python(start)
    end_ns = ns_date_from_python(end)

    predicate = store.predicateForEventsWithStartDate_endDate_calendars_(
        start_ns, end_ns, None
    )
    ek_events = store.eventsMatchingPredicate_(predicate) or []

    # Daemon-side truth for the window: the only honest record of what the
    # node returned, independent of how the voice layer later relays it. The
    # predicate is NOT now-clamped — past-week windows return their full set
    # (verified against the real store: last-week window → 8 events, incl.
    # events earlier than now). Read this line, not the spoken echo, when a
    # weekly smoke looks short.
    log.info(
        "get_week window [%s, %s) → %d event(s)",
        start.date().isoformat(),
        end.date().isoformat(),
        len(ek_events),
    )

    if not ek_events:
        return {
            "available": False,
            "reason": "no_events",
            "week_start": start.date().isoformat(),
            "timestamp": int(datetime.now().timestamp() * 1000),
        }

    # Sort by start time
    events = [format_event(e) for e in ek_events]
    events.sort(key=lambda x: x["start"])

    return {
        "available": True,
        "events": events,
        "week_start": start.date().isoformat(),
        "timestamp": int(datetime.now().timestamp() * 1000),
    }


async def main() -> int:
    node_id = os.getenv("NODE_ID", "calendar")
    secret = os.getenv("MESH_CALENDAR_SECRET")
    core_url = os.getenv("MESH_CORE_URL", "http://127.0.0.1:8000")

    if not secret:
        log.error("MESH_CALENDAR_SECRET environment variable required")
        return 2

    log.info(f"Calendar node starting (node_id={node_id}, core_url={core_url})")

    if not AVAILABLE:
        log.warning("EventKit framework not available; surfaces will report unavailable")

    node = MeshNode(
        node_id=node_id,
        secret=secret,
        core_url=core_url,
    )

    # Register surface handlers
    node.on("today", handle_today)
    node.on("upcoming", handle_upcoming)
    node.on("next_event", handle_next_event)
    node.on("get_week", handle_week)

    try:
        await node.start()

        # Run until interrupted
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        log.info("Shutting down (interrupted)")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
