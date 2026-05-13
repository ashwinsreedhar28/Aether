"""
Base tool interface for RAVEN tools.

Each tool module should follow this pattern:
1. Define FUNCTIONS list with function names it handles
2. Implement get_tools() returning list[types.Tool]
3. Implement handle_call(name, args) returning dict or None
"""

from typing import Protocol, Any
from google.genai import types


class ToolModule(Protocol):
    """Protocol defining the interface for tool modules."""

    FUNCTIONS: list[str]
    """List of function names this module handles."""

    def get_tools(self) -> list[types.Tool]:
        """Return Gemini function declarations for this tool."""
        ...

    def handle_call(self, name: str, args: dict) -> dict[str, Any] | None:
        """
        Handle a function call.

        Args:
            name: The function name being called
            args: The arguments passed to the function

        Returns:
            Result dict if this module handles the function, None otherwise
        """
        ...
