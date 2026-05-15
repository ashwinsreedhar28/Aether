#!/usr/bin/env python3
"""macOS Calendar mesh node.

Reads events from macOS Calendar.app via EventKit. Three surfaces:
- calendar.today: all events on today's date
- calendar.upcoming: next N events from now (default 5, max 20)
- calendar.next_event: single next upcoming event

Sprint 2 data-breadth lane.
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
    """Convert NSDate to Python datetime."""
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
    status = store.authorizationStatusForEntityType_(EKEntityTypeEvent)
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
    status = store.authorizationStatusForEntityType_(EKEntityTypeEvent)
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
    status = store.authorizationStatusForEntityType_(EKEntityTypeEvent)
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
        surfaces={
            "today": handle_today,
            "upcoming": handle_upcoming,
            "next_event": handle_next_event,
        },
    )

    await node.start()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
