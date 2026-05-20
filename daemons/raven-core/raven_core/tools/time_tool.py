"""
Time Tool - Get current date and time via the mesh.

One tool routed through ``mesh_invoke`` to the time node:

  - ``get_current_time(zone?)`` → ``time.now({zone, format: 'human'})``

Pattern matches calendar_tool / clipboard_tool: declare the function
for Gemini, implement as a thin ``await mesh_invoke(...)``, add edges
in manifest.yaml. The time mesh node returns a pre-formatted ``time``
string (e.g. "2:32 PM EDT" with format='human') along with the
resolved ``zone`` and ``unix_ms``.

If the mesh is unavailable, falls back to local computation so voice
queries still work — just without zone awareness.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["get_current_time"]


def _friendly_zone(zone: str) -> str:
    """Convert an IANA zone identifier to a speakable name.

    'Asia/Tokyo'        → 'Tokyo'
    'America/New_York'  → 'New York'
    'Europe/London'     → 'London'

    Falls back to the raw zone string if it doesn't follow Region/City.
    """
    if "/" in zone:
        city = zone.split("/")[-1]
        return city.replace("_", " ")
    return zone


def _local_fallback(zone: str | None) -> dict[str, Any]:
    """Local datetime.now() fallback for when the mesh is unavailable.

    Zone-unaware: ignores any requested zone and returns the system
    local time. Used when ``mesh_invoke`` raises ``MeshUnavailable`` or
    when the daemon's response shape is unusable.
    """
    now = datetime.now()
    time_str = now.strftime("%-I:%M %p")
    date_str = now.strftime("%A, %B %-d, %Y")
    return {
        "spoken": f"It's {time_str}, sir.",
        "time": time_str,
        "date": date_str,
        "zone": None,
        "fallback": True,
    }


async def _get_current_time(zone: str | None) -> dict[str, Any]:
    """Fetch current time, preferring mesh (zone-aware) over local.

    Sends ``format: 'human'`` so the daemon returns a pre-formatted
    string like "2:32 PM EDT" suitable for direct speech. The local
    date is always included alongside (computed from datetime.now())
    so "what's the date" queries can be answered without a second
    invocation.
    """
    args: dict[str, Any] = {"format": "human"}
    if zone:
        args["zone"] = zone

    try:
        response = await mesh_invoke("time.now", args)
    except MeshUnavailable:
        return _local_fallback(zone)
    except Exception as exc:
        err_str = str(exc).lower()
        if "time_bad_zone" in err_str or "bad_zone" in err_str:
            return {
                "error": "bad_zone",
                "zone": zone,
                "spoken": (
                    f"I don't recognize the timezone '{zone}', sir. "
                    "Try an IANA name like 'Asia/Tokyo' or 'Europe/London'."
                ),
            }
        return _local_fallback(zone)

    if not isinstance(response, dict):
        return _local_fallback(zone)

    time_str = response.get("time", "")
    response_zone = response.get("zone") or "local"

    if not time_str:
        return _local_fallback(zone)

    # Local date is always meaningful for date queries.
    date_str = datetime.now().strftime("%A, %B %-d, %Y")

    if zone:
        spoken = f"It's {time_str} in {_friendly_zone(zone)}, sir."
    else:
        spoken = f"It's {time_str}, sir."

    return {
        "spoken": spoken,
        "time": time_str,
        "date": date_str,
        "zone": response_zone,
        "fallback": False,
    }


def get_tools() -> list[types.Tool]:
    """Return Gemini function declaration for the time tool.

    Single optional ``zone`` parameter. The Live audio-preview model is
    biased to skip zero-parameter tools and answer time questions from
    prior knowledge (which it doesn't actually have), so the ``zone``
    parameter serves both as a real input (for queries like "what time
    is it in Tokyo") and as a presence-trigger that keeps the model
    honest.
    """
    func = types.FunctionDeclaration(
        name="get_current_time",
        description=(
            "Returns the current time, optionally in a specified "
            "timezone, plus the local date. ALWAYS call this when the "
            "user asks the time, the date, what day it is, or any "
            "time/date question. Do not answer such questions from "
            "prior knowledge — you do not know the current time. Use "
            "the returned 'spoken' field directly for time replies; "
            "use 'date' for date replies. For 'what time is it in "
            "Tokyo' style queries, pass the IANA zone name (e.g. "
            "'Asia/Tokyo', 'Europe/London', 'America/New_York')."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "zone": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Optional IANA timezone name (e.g. 'Asia/Tokyo', "
                        "'Europe/London', 'America/New_York'). Omit for "
                        "local time."
                    ),
                ),
            },
        ),
    )
    return [types.Tool(function_declarations=[func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry.

    Note: this tool used to be synchronous (handle_call) when it
    computed time locally. Now that it routes through the mesh
    (await mesh_invoke), it must be async. The voice-tool-registry
    auto-discovers either handle_call or handle_call_async.
    """
    if name == "get_current_time":
        zone = args.get("zone")
        if zone is not None and not isinstance(zone, str):
            zone = None
        return await _get_current_time(zone)
    return None
