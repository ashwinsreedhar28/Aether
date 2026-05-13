"""
Time Tool - Get current date and time.
"""

from datetime import datetime
from typing import Any

from google.genai import types

FUNCTIONS = ["get_current_time"]


def get_current_time() -> dict[str, str]:
    """
    Get the current local date and time.

    Returns the time as a human-friendly string the model can speak directly,
    plus structured fields for any further reasoning.
    """
    now = datetime.now()
    return {
        "spoken_time": now.strftime("%-I:%M %p"),  # e.g. "3:07 PM"
        "spoken_date": now.strftime("%A, %B %-d, %Y"),  # e.g. "Tuesday, May 12, 2026"
        "iso_format": now.isoformat(),
    }


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for time tool.

    Note: parameter-less tools should omit `parameters` entirely rather than
    pass an empty-properties Schema — empty schemas can confuse Gemini's
    tool-selector and cause the model to answer time questions from prior
    knowledge instead of calling this tool.
    """
    func = types.FunctionDeclaration(
        name="get_current_time",
        description=(
            "Returns the current local time and date on the user's machine. "
            "ALWAYS call this when the user asks the time, the date, what day "
            "it is, or any 'what time / what day' question. Do not answer "
            "such questions from your own knowledge — you do not know the "
            "current time. Use the spoken_time field directly in your reply."
        ),
    )
    return [types.Tool(function_declarations=[func])]


def handle_call(name: str, args: dict) -> dict[str, Any] | None:
    """Handle function calls for time tool."""
    if name == "get_current_time":
        return get_current_time()
    return None
