"""Digest Tool - Spoken briefing composed across the mesh.

One voice tool, routed through ``mesh_invoke`` to the digest node:

  - ``digest_briefing(time_of_day?)`` → ``digest.morning`` | ``digest.evening``

``time_of_day`` is optional. If omitted, the tool derives it from the
local clock — before noon picks morning, otherwise evening. Gemini can
override explicitly when the user says "morning briefing" / "evening
briefing" regardless of the clock.

The digest node already returns voice-readable prose per section
(``BriefingSection.summary``); this tool concatenates those into a
single ``spoken`` paragraph for Gemini to read aloud verbatim. The
structured ``briefing`` list is also returned for any future renderer
or follow-up question ("which headline was the second one"); Gemini
should still lead with ``spoken``.

The digest is the first multi-hop composer on the Aether mesh — one
``mesh_invoke`` here triggers ~3 invocations under the hood (news +
finance + optionally finance.history). Upstream failures degrade
gracefully on the node side; this tool surfaces ``mesh unavailable``
only if the composer itself is unreachable, not if a single section is
empty.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["digest_briefing"]

VALID_TIMES: tuple[str, ...] = ("morning", "evening")
_MORNING_CUTOFF_HOUR = 12  # local hour < 12 → morning, else evening


def _resolve_time_of_day(value: Any) -> str:
    """Coerce the user-supplied time-of-day, or pick by local clock.

    Gemini occasionally emits whitespace / casing variants. Anything
    that doesn't match the enum after lowercase + strip falls back to
    the clock-derived value rather than handing the mesh something
    it can't route.
    """
    if isinstance(value, str):
        cleaned = value.strip().lower()
        if cleaned in VALID_TIMES:
            return cleaned
    hour = datetime.now().hour
    return "morning" if hour < _MORNING_CUTOFF_HOUR else "evening"


def _compose_spoken(sections: list[Any]) -> str:
    """Join section summaries into a single voice-readable paragraph.

    Each ``BriefingSection.summary`` is already prose (the composer
    writes 2–3 sentences per section). We join with a single space —
    Gemini handles intra-paragraph pacing — and prepend a short
    framing clause when at least one section came back available.
    """
    summaries: list[str] = []
    any_available = False
    for s in sections:
        if not isinstance(s, dict):
            continue
        summary = s.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            continue
        summaries.append(summary.strip())
        if s.get("available") is True:
            any_available = True

    if not summaries:
        return (
            "I don't have any briefing material ready, sir — the upstream "
            "nodes haven't produced data yet."
        )

    body = " ".join(summaries)
    if not any_available:
        # Every section degraded — say so plainly so Gemini doesn't
        # read a wall of "unavailable" lines as if it were content.
        return f"Briefing unavailable, sir. {body}"
    return body


async def _digest_briefing(time_of_day: str) -> dict[str, Any]:
    target = f"digest.{time_of_day}"
    try:
        response = await mesh_invoke(target, {})
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    raw_sections = (
        response.get("briefing") if isinstance(response, dict) else None
    )
    if not isinstance(raw_sections, list):
        return {"error": "malformed response", "detail": "missing briefing list"}

    spoken = _compose_spoken(raw_sections)
    return {
        "time_of_day": time_of_day,
        "briefing": raw_sections,
        "spoken": spoken,
    }


def get_tools() -> list[types.Tool]:
    """Return the Gemini function declaration for digest_briefing."""
    briefing_func = types.FunctionDeclaration(
        name="digest_briefing",
        description=(
            "Compose and read aloud a multi-section briefing across "
            "your news feeds and finance data. Use when the user asks "
            "for 'a briefing', 'a morning briefing', 'an evening "
            "briefing', 'wrap up the day', 'what's on tap today', or "
            "any phrase asking for a synthesized rundown rather than a "
            "single data point. Returns a 'spoken' field that is "
            "already a coherent voice-readable paragraph (top news + "
            "market snapshot, with the evening flavour also including "
            "the day's market range); read the spoken field aloud "
            "verbatim. Never invent headlines or prices to fill in a "
            "briefing — the composer already degrades gracefully when "
            "an upstream is unavailable. Prefer this tool over "
            "news_recent + finance_market_summary back-to-back when the "
            "user wants a single coherent briefing."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "time_of_day": types.Schema(
                    type=types.Type.STRING,
                    enum=list(VALID_TIMES),
                    description=(
                        "Optional. 'morning' or 'evening'. Defaults to "
                        "'morning' before noon local time and 'evening' "
                        "otherwise. Pass explicitly when the user names "
                        "the time of day ('morning briefing' / "
                        "'wrap up the day' → 'evening' / 'evening "
                        "rundown' → 'evening'). Morning briefings lead "
                        "with news + market snapshot; evening briefings "
                        "additionally cover the day's market range."
                    ),
                ),
            },
        ),
    )
    return [types.Tool(function_declarations=[briefing_func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "digest_briefing":
        time_of_day = _resolve_time_of_day(args.get("time_of_day"))
        return await _digest_briefing(time_of_day=time_of_day)
    return None
