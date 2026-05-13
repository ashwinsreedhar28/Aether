"""
Silence Tool - Allow RAVEN to stay quiet when not directly addressed.
"""

from typing import Any
from google.genai import types

FUNCTIONS = ["no_response"]


def no_response() -> dict[str, Any]:
    """
    Signal that RAVEN should remain silent.
    Used when not directly addressed or when there's nothing to add.
    """
    # Just return quietly - no logging to avoid spam
    return {"status": "silent"}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for silence tool."""
    func = types.FunctionDeclaration(
        name="no_response",
        description=(
            "Call this function to remain silent and not respond. "
            "Use this when you are NOT being directly addressed, "
            "when the user is talking to someone else, "
            "or when you have nothing meaningful to add to the conversation. "
            "This allows you to listen quietly without interrupting."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},
        ),
    )
    return [types.Tool(function_declarations=[func])]


def handle_call(name: str, args: dict) -> dict[str, Any] | None:
    """Handle function calls for silence tool."""
    if name == "no_response":
        return no_response()
    return None
