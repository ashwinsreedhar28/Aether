"""
Time Tool - Get current date and time.
"""

from datetime import datetime
from typing import Any

from google.genai import types

FUNCTIONS = ["get_current_time"]


def get_current_time() -> dict[str, str]:
    """
    Get the current date and time.

    Returns:
        Dict with time in multiple formats
    """
    now = datetime.now()
    return {
        "time": now.strftime("%Y-%m-%d %H:%M:%S"),
        "iso_format": now.isoformat(),
        "day_of_week": now.strftime("%A"),
    }


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for time tool."""
    func = types.FunctionDeclaration(
        name="get_current_time",
        description="Get the current date and time. Useful when the user asks about the time or date.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},
        ),
    )
    return [types.Tool(function_declarations=[func])]


def handle_call(name: str, args: dict) -> dict[str, Any] | None:
    """Handle function calls for time tool."""
    if name == "get_current_time":
        return get_current_time()
    return None
