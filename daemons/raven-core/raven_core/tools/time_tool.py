"""
Time Tool - Get current date and time.
"""

from datetime import datetime
from typing import Any

from google.genai import types

FUNCTIONS = ["get_current_time"]


def get_current_time(format: str = "12h") -> dict[str, str]:
    """
    Get the current local date and time.

    Args:
        format: '12h' for 12-hour with AM/PM (default) or '24h' for 24-hour.

    Returns the time as a human-friendly string the model can speak directly,
    plus structured fields for any further reasoning.
    """
    now = datetime.now()
    time_fmt = "%-I:%M %p" if format != "24h" else "%H:%M"
    return {
        "spoken_time": now.strftime(time_fmt),  # e.g. "3:07 PM" or "15:07"
        "spoken_date": now.strftime("%A, %B %-d, %Y"),  # e.g. "Tuesday, May 12, 2026"
        "iso_format": now.isoformat(),
    }


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for time tool.

    A parameter is intentionally declared (even though optional) — the Live
    audio-preview model is biased to skip zero-parameter tools and answer
    time/date questions from prior knowledge (which it doesn't actually
    have). Giving it an `format` parameter aligns this tool's shape with
    the working memory_tool declarations.
    """
    func = types.FunctionDeclaration(
        name="get_current_time",
        description=(
            "Returns the current local time and date on the user's machine. "
            "ALWAYS call this when the user asks the time, the date, what "
            "day it is, or any time/date question. Do not answer such "
            "questions from prior knowledge — you do not know the current "
            "time. Use the returned spoken_time / spoken_date fields "
            "directly in your reply."
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
            },
        ),
    )
    return [types.Tool(function_declarations=[func])]


def handle_call(name: str, args: dict) -> dict[str, Any] | None:
    """Handle function calls for time tool."""
    if name == "get_current_time":
        return get_current_time(format=args.get("format", "12h"))
    return None
