# Calendar Node

macOS Calendar.app mesh node. Reads events via EventKit.

## Surfaces

- `calendar.today` — events on today's date, sorted by start time
- `calendar.upcoming` — next N events from now (default 5, max 20); accepts `{ "limit"?: number }`
- `calendar.next_event` — single next upcoming event (no params)

## Response shape

Success:
```json
{
  "available": true,
  "events": [
    {
      "title": "1:1 with Brett",
      "start": "2026-05-14T15:00:00-07:00",
      "end": "2026-05-14T15:30:00-07:00",
      "location": "Zoom",
      "calendar_name": "Work",
      "is_all_day": false,
      "notes": "..."
    }
  ],
  "timestamp": 1715731234567
}
```

Failure:
```json
{
  "available": false,
  "reason": "permission_denied" | "no_events" | "framework_unavailable"
}
```

## Permissions

On first read, macOS prompts for Calendar.app access. Grant permission in System Settings > Privacy & Security > Calendar if needed.

## Voice tools

- `calendar_today()` — speaks today's events naturally
- `calendar_next()` — speaks the next single event
- `calendar_upcoming(limit=5)` — speaks next N events

## Out of scope (v1)

- Calendar editing (read-only)
- Multi-calendar selection (uses default-selected calendars)
- Recurring event expansion edge cases
- Cross-platform (macOS only)
