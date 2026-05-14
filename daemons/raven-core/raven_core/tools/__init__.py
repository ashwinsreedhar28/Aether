"""
RAVEN Tool Registry

Automatically discovers and registers tool modules.
Each tool module should export:
    - get_tools() -> list[types.Tool]
    - handle_call(name: str, args: dict) -> dict | None        (sync tools)
      OR
      handle_call_async(name, args) -> Awaitable[dict | None]  (async tools)

Sync handlers stay direct — time + memory tools have no I/O and don't
need an event loop. Async handlers exist so mesh-routed tools (notify
and successors) can `await mesh_invoke(...)` inside the orchestrator's
running event loop without the run_until_complete deadlock that would
hit a sync-wrapped async call.
"""

import inspect
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
from . import notify_tool
from . import news_tool

# Disabled until mesh integration:
# from . import cerebras_tool   # second-LLM HTML generator, needs Flask sidecar
# from . import silence_tool    # no_response gating, low priority for the demo
# from . import system_tool     # macOS shell-out (open_url, open_app) — needs scoping

_TOOL_MODULES = [
    time_tool,
    memory_tool,
    notify_tool,
    news_tool,
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


async def handle_function_call(name: str, args: dict) -> dict[str, Any]:
    """
    Route a function call to the appropriate tool module.

    Async because mesh-routed tools (notify) need to await mesh_invoke
    on the orchestrator's running event loop. Sync tools (time, memory)
    return their dict immediately; we don't await them, we just call
    handle_call as before.
    """
    for module in _TOOL_MODULES:
        async_handler = getattr(module, "handle_call_async", None)
        if async_handler is not None and inspect.iscoroutinefunction(async_handler):
            result = await async_handler(name, args)
            if result is not None:
                return result
            continue
        sync_handler = getattr(module, "handle_call", None)
        if sync_handler is not None:
            result = sync_handler(name, args)
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
