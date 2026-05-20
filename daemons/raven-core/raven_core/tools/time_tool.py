"""
Time Tool - Get current date and time via the mesh.

One tool routed through ``mesh_invoke`` to the time node:

  - ``get_current_time(format?, zone?)``  → ``time.now(zone)``

Pattern matches calendar_tool / clipboard_tool: declare the function
for Gemini, implement as a thin ``await mesh_invoke(...)``, add edges
in manifest.yaml. The time mesh node returns timezone-aware time with
ISO format, spoken_time, and spoken_date fields.

If the mesh is unavailable, falls back to local computation so voice
queries still work — just without zone support.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["get_current_time"]


def _local_fallback(format_pref: str) -> dict[str, Any]:
    """Local datetime.now() fallback for when the mesh is unavailable.

    Preserves the original behavior of the local-only time tool: format
    according to the user's preference, return spoken/iso fields. No
    zone awareness in this path — that's mesh-only.
    """
    now = datetime.now()
    time_fmt = "%H:%M" if format_pref == "24h" else "%-I:%M %p"
    return {
        "spoken_time": now.strftime(time_fmt),
        "spoken_date": now.strftime("%A, %B %-d, %Y"),
        "iso_format": now.isoformat(),
        "zone": None,
        "fallback": True,
    }


async def _get_current_time(format_pref: str, zone: str | None) -> dict[str, Any]:
    """Fetch current time, preferring mesh (zone-aware) over local."""
    args: dict[str, Any] = {"format": format_pref}
    if zone:
        args["zone"] = zone

    try:
        response = await mesh_invoke("time.now", args)
    except MeshUnavailable:
        return _local_fallback(format_pref)

    if not isinstance(response, dict):
        return _local_fallback(format_pref)

    available = response.get("available", True)
    if not available:
        reason = response.get("reason", "unknown")
        if reason == "time_bad_zone":
            return {
                "error": "bad_zone",
                "spoken_time": "",
                "spoken_date": "",
                "iso_format": "",
                "zone": zone,
                "spoken": (
                    f"I don't recognize the timezone '{zone}', sir. "
                    "Try a region like 'Asia/Tokyo' or a city like 'London'."
                ),
            }
        return _local_fallback(format_pref)

    return {
        "spoken_time": response.get("spoken_time", ""),
        "spoken_date": response.get("spoken_date", ""),
        "iso_format": response.get("iso_format", ""),
        "zone": response.get("zone", zone),
        "fallback": False,
    }


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for time tool.

    Two parameters are intentionally declared (both optional) — the Live
    audio-preview model is biased to skip zero-parameter tools and answer
    time/date questions from prior knowledge (which it doesn't actually
    have). Giving it `format` and `zone` parameters aligns this tool's
    shape with the working memory_tool declarations and exposes the new
    timezone-aware mesh node.
    """
    func = types.FunctionDeclaration(
        name="get_current_time",
        description=(
            "Returns the current local time and date, or the time in a "
            "specified timezone. ALWAYS call this when the user asks the "
            "time, the date, what day it is, or any time/date question. "
            "Do not answer such questions from prior knowledge — you do "
            "not know the current time. Use the returned spoken_time / "
            "spoken_date fields directly in your reply. For 'what time "
            "is it in Tokyo' style queries, pass the IANA zone name "
            "(e.g. 'Asia/Tokyo', 'Europe/London', 'America/New_York')."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "format": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Optional. '12h' for 12-hour with AM/PM (default) "
                        "or '24h' for 24-hour clock."
                    ),
                    enum=["12h", "24h"],
                ),
                "zone": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Optional IANA timezone name (e.g. 'Asia/Tokyo', "
                        "'Europe/London'). Omit for local time."
                    ),
                ),
            },
        ),
    )
    return [types.Tool(function_declarations=[func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry.

    Note: this tool used to be synchronous (handle_call) when it computed
    time locally. Now that it routes through the mesh (await mesh_invoke),
    it must be async. The voice-tool-registry auto-discovers either
    handle_call or handle_call_async.
    """
    if name == "get_current_time":
        format_pref = args.get("format", "12h")
        if format_pref not in ("12h", "24h"):
            format_pref = "12h"
        zone = args.get("zone")
        if zone is not None and not isinstance(zone, str):
            zone = None
        return await _get_current_time(format_pref, zone)
    return None
