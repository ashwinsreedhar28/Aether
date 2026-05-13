"""
RAVEN Tool Registry

Automatically discovers and registers tool modules.
Each tool module should export:
    - get_tools() -> list[types.Tool]
    - handle_call(name: str, args: dict) -> dict | None
"""

from typing import Any
from google.genai import types

# Import only the tool modules we ship enabled in homeOS week-1.
# Other VIEWER tools (cerebras_tool, silence_tool, system_tool) stay
# vendored on disk but are NOT registered here, so they cannot be
# called. They get re-enabled once voice is rebased onto the mesh and
# the security model for shell-out (system_tool) / second-LLM
# (cerebras_tool) is sorted.
from . import time_tool
from . import memory_tool

# Disabled until mesh integration:
# from . import cerebras_tool   # second-LLM HTML generator, needs Flask sidecar
# from . import silence_tool    # no_response gating, low priority for the demo
# from . import system_tool     # macOS shell-out (open_url, open_app) — needs scoping

_TOOL_MODULES = [
    time_tool,
    memory_tool,
]


def get_all_tool_declarations() -> list[types.Tool]:
    """
    Aggregate all tool declarations from registered modules.
    Returns a list of types.Tool objects for Gemini config.
    """
    tools = []
    for module in _TOOL_MODULES:
        if hasattr(module, "get_tools"):
            module_tools = module.get_tools()
            tools.extend(module_tools)
    return tools


def handle_function_call(name: str, args: dict) -> dict[str, Any]:
    """
    Route a function call to the appropriate tool module.

    Args:
        name: The function name to call
        args: The arguments to pass to the function

    Returns:
        The result dict from the function, or an error dict
    """
    for module in _TOOL_MODULES:
        if hasattr(module, "handle_call"):
            result = module.handle_call(name, args)
            if result is not None:
                return result

    return {"error": f"Unknown function: {name}"}


def get_registered_functions() -> list[str]:
    """Return a list of all registered function names."""
    functions = []
    for module in _TOOL_MODULES:
        if hasattr(module, "FUNCTIONS"):
            functions.extend(module.FUNCTIONS)
    return functions
