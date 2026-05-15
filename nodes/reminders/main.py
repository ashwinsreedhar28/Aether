#!/usr/bin/env python3
"""macOS Reminders mesh node.

Reads reminders from macOS Reminders.app via EventKit. Three surfaces:
- reminders.due_today: reminders due today (incomplete only)
- reminders.overdue: past-due reminders (incomplete only)
- reminders.upcoming: next N upcoming reminders (default 10, max 50)

Sprint 2 data-breadth lane.
"""

import asyncio
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any
import time

# Add core SDK to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../core"))

from node_sdk import MeshNode

# macOS framework imports
try:
    import objc
    from Foundation import NSDate, NSCalendar, NSDateComponents
    from EventKit import (
        EKEventStore,
        EKEntityTypeReminder,
        EKAuthorizationStatusAuthorized,
    )

    AVAILABLE = True
except ImportError:
    AVAILABLE = False

log = logging.getLogger("reminders")
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)


def datecomponents_to_iso(components: Any) -> str | None:
    """Convert NSDateComponents to ISO 8601 string.

    Returns None if components is None (no due date set).
    """
    if not components:
        return None

    try:
        # Extract components (some may be undefined)
        year = components.year() if hasattr(components, 'year') else None
        month = components.month() if hasattr(components, 'month') else None
        day = components.day() if hasattr(components, 'day') else None
        hour = components.hour() if hasattr(components, 'hour') else 0
        minute = components.minute() if hasattr(components, 'minute') else 0
        second = components.second() if hasattr(components, 'second') else 0

        # Need at least year/month/day
        if not all([year, month, day]):
            return None

        # Create datetime (naive for now)
        dt = datetime(int(year), int(month), int(day), int(hour), int(minute), int(second))

        # Get timezone from components if available, else use local
        tz_obj = components.timeZone() if hasattr(components, 'timeZone') and components.timeZone() else None
        if tz_obj:
            # NSTimeZone -> seconds offset
            offset_seconds = tz_obj.secondsFromGMT()
            tz = timezone(timedelta(seconds=offset_seconds))
            dt = dt.replace(tzinfo=tz)
        else:
            # Use system local timezone
            dt = dt.astimezone()

        return dt.isoformat()
    except (ValueError, AttributeError, TypeError) as e:
        log.warning(f"Failed to convert date components: {e}")
        return None


def format_reminder(reminder: Any) -> dict[str, Any]:
    """Format an EKReminder into response shape."""
    due_components = reminder.dueDateComponents()
    due_iso = datecomponents_to_iso(due_components)

    return {
        "title": str(reminder.title() or "Untitled"),
        "due_date": due_iso,
        "is_completed": bool(reminder.isCompleted()),
        "list_name": str(reminder.calendar().title() or ""),
        "priority": int(reminder.priority() or 0),
        "notes": str(reminder.notes() or ""),
    }


async def fetch_all_reminders(store: Any) -> list[Any]:
    """Fetch all reminders via async completion handler bridge."""
    results = []
    event = asyncio.Event()

    def completion_handler(reminder_list):
        nonlocal results
        if reminder_list:
            results = list(reminder_list)
        event.set()

    # Fetch all reminders (None = all calendars/lists)
    predicate = store.predicateForRemindersInCalendars_(None)
    store.fetchRemindersMatchingPredicate_completion_(predicate, completion_handler)

    # Wait for callback (run in executor to avoid blocking)
    await asyncio.wait_for(event.wait(), timeout=10.0)

    return results


async def handle_due_today(params: dict[str, Any]) -> dict[str, Any]:
    """Fetch reminders due today (incomplete only)."""
    if not AVAILABLE:
        return {"available": False, "reason": "framework_unavailable"}

    store = EKEventStore.alloc().init()

    # Check authorization (class method, not instance)
    status = EKEventStore.authorizationStatusForEntityType_(EKEntityTypeReminder)
    if status != EKAuthorizationStatusAuthorized:
        granted = await asyncio.to_thread(
            lambda: store.requestAccessToEntityType_completion_(
                EKEntityTypeReminder, None
            )
        )
        if not granted:
            return {"available": False, "reason": "permission_denied"}

    # Fetch all reminders
    all_reminders = await fetch_all_reminders(store)

    # Filter to incomplete + due today
    now = datetime.now().astimezone()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)

    due_today = []
    for rem in all_reminders:
        if rem.isCompleted():
            continue

        due_components = rem.dueDateComponents()
        due_iso = datecomponents_to_iso(due_components)
        if not due_iso:
            continue

        try:
            due_dt = datetime.fromisoformat(due_iso)
            if today_start <= due_dt < today_end:
                due_today.append(format_reminder(rem))
        except ValueError:
            continue

    # Sort by due_date
    due_today.sort(key=lambda x: x["due_date"] or "")

    return {
        "available": True,
        "reminders": due_today,
        "timestamp": int(time.time() * 1000),
    }


async def handle_overdue(params: dict[str, Any]) -> dict[str, Any]:
    """Fetch overdue reminders (past due, incomplete)."""
    if not AVAILABLE:
        return {"available": False, "reason": "framework_unavailable"}

    store = EKEventStore.alloc().init()

    # Check authorization
    status = EKEventStore.authorizationStatusForEntityType_(EKEntityTypeReminder)
    if status != EKAuthorizationStatusAuthorized:
        granted = await asyncio.to_thread(
            lambda: store.requestAccessToEntityType_completion_(
                EKEntityTypeReminder, None
            )
        )
        if not granted:
            return {"available": False, "reason": "permission_denied"}

    # Fetch all reminders
    all_reminders = await fetch_all_reminders(store)

    # Filter to incomplete + overdue
    now = datetime.now().astimezone()

    overdue = []
    for rem in all_reminders:
        if rem.isCompleted():
            continue

        due_components = rem.dueDateComponents()
        due_iso = datecomponents_to_iso(due_components)
        if not due_iso:
            continue

        try:
            due_dt = datetime.fromisoformat(due_iso)
            if due_dt < now:
                overdue.append(format_reminder(rem))
        except ValueError:
            continue

    # Sort by due_date (oldest first)
    overdue.sort(key=lambda x: x["due_date"] or "")

    return {
        "available": True,
        "reminders": overdue,
        "timestamp": int(time.time() * 1000),
    }


async def handle_upcoming(params: dict[str, Any]) -> dict[str, Any]:
    """Fetch next N upcoming reminders (incomplete, future due dates)."""
    if not AVAILABLE:
        return {"available": False, "reason": "framework_unavailable"}

    limit = params.get("limit", 10)
    limit = max(1, min(limit, 50))  # Clamp to 1-50

    store = EKEventStore.alloc().init()

    # Check authorization
    status = EKEventStore.authorizationStatusForEntityType_(EKEntityTypeReminder)
    if status != EKAuthorizationStatusAuthorized:
        granted = await asyncio.to_thread(
            lambda: store.requestAccessToEntityType_completion_(
                EKEntityTypeReminder, None
            )
        )
        if not granted:
            return {"available": False, "reason": "permission_denied"}

    # Fetch all reminders
    all_reminders = await fetch_all_reminders(store)

    # Filter to incomplete + future due dates
    now = datetime.now().astimezone()

    upcoming = []
    for rem in all_reminders:
        if rem.isCompleted():
            continue

        due_components = rem.dueDateComponents()
        due_iso = datecomponents_to_iso(due_components)
        if not due_iso:
            continue

        try:
            due_dt = datetime.fromisoformat(due_iso)
            if due_dt >= now:
                upcoming.append(format_reminder(rem))
        except ValueError:
            continue

    # Sort by due_date and take first N
    upcoming.sort(key=lambda x: x["due_date"] or "")
    upcoming = upcoming[:limit]

    return {
        "available": True,
        "reminders": upcoming,
        "timestamp": int(time.time() * 1000),
    }


async def main() -> int:
    node_id = os.getenv("NODE_ID", "reminders")
    secret = os.getenv("MESH_REMINDERS_SECRET")
    core_url = os.getenv("MESH_CORE_URL", "http://127.0.0.1:8000")

    if not secret:
        log.error("MESH_REMINDERS_SECRET environment variable required")
        return 2

    log.info(f"Reminders node starting (node_id={node_id}, core_url={core_url})")

    if not AVAILABLE:
        log.warning("EventKit framework not available; surfaces will report unavailable")

    node = MeshNode(
        node_id=node_id,
        secret=secret,
        core_url=core_url,
    )

    # Register surface handlers (use node.on(), not surfaces= kwarg)
    node.on("due_today", handle_due_today)
    node.on("overdue", handle_overdue)
    node.on("upcoming", handle_upcoming)

    try:
        await node.start()

        # Keep-alive loop (critical: prevents process exit)
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        log.info("Shutting down (interrupted)")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
