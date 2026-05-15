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

import importlib
import inspect
import logging
from pathlib import Path
from typing import Any
from google.genai import types

from ..session_context import get_session_context

logger = logging.getLogger(__name__)

# Auto-discover tool modules in this directory.
# Any Python module with get_tools() and (handle_call or handle_call_async)
# is registered automatically. Modules without those exports are skipped.
# This replaces the manual import + list pattern — adding a new voice tool
# is now a single-file change.

_TOOL_MODULES = []

# Disabled modules that should NOT be auto-discovered.
# These are vendored on disk but excluded from registration until the
# security model for shell-out (system_tool) / second-LLM (cerebras_tool)
# is sorted, or until mesh integration completes (silence_tool).
_DISABLED_MODULES = frozenset([
    "cerebras_tool",  # second-LLM HTML generator, needs Flask sidecar
    "silence_tool",   # no_response gating, low priority for the demo
    "system_tool",    # macOS shell-out (open_url, open_app) — needs scoping
])

def _discover_tool_modules():
    """
    Discover and load all tool modules in the tools/ directory.

    For each .py file (excluding __init__.py and base.py), attempt to import
    the module. If it exports both get_tools() and at least one of
    (handle_call, handle_call_async), add it to _TOOL_MODULES.

    Modules in _DISABLED_MODULES are skipped even if they have the exports.
    Failed imports raise immediately — a broken tool file is a real problem.
    Modules missing the required exports are skipped silently.

    Order is stable (alphabetical by module name) for predictable log output.
    """
    global _TOOL_MODULES
    tools_dir = Path(__file__).parent
    discovered = []

    # List all .py files except __init__.py and base.py
    py_files = sorted(tools_dir.glob("*.py"))
    for py_file in py_files:
        module_name = py_file.stem
        if module_name in ("__init__", "base"):
            continue

        # Skip disabled modules
        if module_name in _DISABLED_MODULES:
            continue

        # Import the module — let import errors propagate
        try:
            module = importlib.import_module(f".{module_name}", package=__package__)
        except Exception:
            logger.exception(f"[tools] failed to import {module_name}")
            raise

        # Check for required exports
        has_get_tools = hasattr(module, "get_tools") and callable(module.get_tools)
        has_sync_handler = hasattr(module, "handle_call") and callable(module.handle_call)
        has_async_handler = hasattr(module, "handle_call_async") and callable(module.handle_call_async)

        if has_get_tools and (has_sync_handler or has_async_handler):
            discovered.append((module_name, module))

    # Sort alphabetically by module name for stable ordering
    discovered.sort(key=lambda x: x[0])
    _TOOL_MODULES = [mod for _, mod in discovered]

    # Log discovery result
    module_names = [name for name, _ in discovered]
    logger.info(f"[tools] registry discovered {len(module_names)} tool modules: {', '.join(module_names)}")

# Run discovery at import time
_discover_tool_modules()


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


# ---------------------------------------------------------------------------
# Session-context updaters
#
# After every tool call we update the per-session SessionContext (see
# raven_core/session_context.py) with two things:
#
#   1. A short one-line ``result_summary`` recapping what the tool did,
#      pushed onto a 5-deep ring of recent tool calls. This becomes the
#      ``recent_tool_calls`` field on the context summary injected back
#      into Gemini's input stream on the next FunctionResponse.
#
#   2. Topical state — last_ticker, last_category, last_entity, the
#      cached article and quote lists — so anaphora ("how about last
#      week", "the second one", "go back to that") resolves without
#      requiring Gemini to remember the previous tool's full JSON.
#
# The updater lives in this module because the topical-extraction logic
# is tool-specific knowledge. Keeping it next to the tool dispatch (and
# off the orchestrator's hot path) means a new tool only has to touch
# one file to participate in conversational context.
#
# The orchestrator calls ``update_session_context(...)`` directly after
# ``handle_function_call(...)`` returns; it then reads the SessionContext
# summary and attaches it to the outgoing FunctionResponse as a
# ``_session_context`` field. That is the per-turn injection point — see
# the comment block at the top of session_context.py for why
# FunctionResponse augmentation is the closest feasible equivalent to
# "re-format the system prompt at each turn" given Gemini Live's
# connect-time-only system_instruction.
# ---------------------------------------------------------------------------


def _format_change_percent(value: Any) -> str:
    """Short signed percent string for spoken-style summaries."""
    if isinstance(value, (int, float)):
        return f"{value:+.2f}%"
    return "?"


def _format_price(value: Any) -> str:
    if isinstance(value, (int, float)):
        return f"${value:.2f}"
    return "?"


def _summarise_news(name: str, args: dict, result: dict) -> str:
    """Build the one-line recap for news_recent / news_search."""
    if "error" in result:
        return f"{name} error: {result.get('error')}"
    count = result.get("count", 0)
    category = result.get("filtered_category")
    if name == "news_search":
        query = result.get("query") or args.get("query", "?")
        suffix = f" [{category}]" if category else ""
        return f"news_search('{query}'): {count} article(s){suffix}"
    suffix = f" [{category}]" if category else ""
    return f"news_recent: {count} headline(s){suffix}"


def _summarise_finance_quote(result: dict) -> str:
    if "error" in result:
        return f"finance_quote error: {result.get('error')}"
    quote = result.get("quote") or {}
    symbol = quote.get("symbol", "?")
    return (
        f"finance_quote({symbol}): "
        f"{_format_price(quote.get('price'))} "
        f"{_format_change_percent(quote.get('change_percent'))}"
    )


def _summarise_finance_market_summary(result: dict) -> str:
    if "error" in result:
        return f"finance_market_summary error: {result.get('error')}"
    return f"finance_market_summary: {result.get('count', 0)} quote(s)"


def _summarise_finance_history(args: dict, result: dict) -> str:
    if "error" in result:
        return f"finance_history error: {result.get('error')}"
    symbol = result.get("symbol") or args.get("symbol", "?")
    period = result.get("period") or args.get("period", "?")
    samples = result.get("samples", 0)
    if samples < 2:
        return f"finance_history({symbol}, {period}): insufficient history"
    return (
        f"finance_history({symbol}, {period}): "
        f"{_format_price(result.get('low'))}–{_format_price(result.get('high'))}, "
        f"{_format_change_percent(result.get('change_percent'))}"
    )


def _summarise_weather_current(result: dict) -> str:
    if "error" in result:
        return f"weather_current error: {result.get('error')}"
    if not result.get("available"):
        return "weather_current: not configured"
    location = result.get("location", "?")
    temp_f = result.get("temperature_f")
    conditions = result.get("conditions", "?")
    return f"weather_current({location}): {temp_f}°F, {conditions}"


def _summarise_weather_forecast(args: dict, result: dict) -> str:
    if "error" in result:
        return f"weather_forecast error: {result.get('error')}"
    if not result.get("available"):
        return "weather_forecast: not configured"
    location = result.get("location", "?")
    days = result.get("days") or args.get("days", 3)
    return f"weather_forecast({location}): {days} day(s)"


def _summarise_calendar(name: str, result: dict) -> str:
    if "error" in result:
        return f"{name} error: {result.get('error')}"
    count = result.get("count", 0)
    if count == 0:
        return f"{name}: no events"
    if name == "calendar_next":
        event = result.get("event") or {}
        title = event.get("title", "?")
        return f"calendar_next: {title}"
    return f"{name}: {count} event(s)"


def _summarise_generic(name: str, result: dict) -> str:
    if isinstance(result, dict) and "error" in result:
        return f"{name} error: {result.get('error')}"
    return f"{name}: ok"


def update_session_context(name: str, args: dict, result: Any) -> None:
    """Push tool call + topical state into the SessionContext singleton.

    Called by the orchestrator immediately after handle_function_call
    returns. Failures here must NOT propagate — context tracking is
    a best-effort aid to Gemini's reference resolution, not a
    correctness requirement on the tool path. Anything unexpected
    (non-dict result, missing fields) falls back to a generic summary.
    """
    ctx = get_session_context()
    args = args or {}
    result_dict = result if isinstance(result, dict) else {}

    # Per-tool topical updates first (the summary is built from the
    # already-extracted fields where convenient).
    summary: str
    try:
        if name in ("news_recent", "news_search"):
            articles = result_dict.get("articles") or []
            category = result_dict.get("filtered_category")
            entity = result_dict.get("query") if name == "news_search" else None
            ctx.set_articles(articles, category=category, entity=entity)
            summary = _summarise_news(name, args, result_dict)
        elif name == "finance_quote":
            quote = result_dict.get("quote") or {}
            symbol = quote.get("symbol") or args.get("symbol")
            if symbol:
                ctx.set_ticker(str(symbol))
            summary = _summarise_finance_quote(result_dict)
        elif name == "finance_market_summary":
            ctx.set_quotes(result_dict.get("quotes") or [])
            summary = _summarise_finance_market_summary(result_dict)
        elif name == "finance_history":
            symbol = result_dict.get("symbol") or args.get("symbol")
            if symbol:
                ctx.set_ticker(str(symbol))
            summary = _summarise_finance_history(args, result_dict)
        elif name == "weather_current":
            summary = _summarise_weather_current(result_dict)
        elif name == "weather_forecast":
            summary = _summarise_weather_forecast(args, result_dict)
        elif name in ("calendar_today", "calendar_next", "calendar_upcoming"):
            summary = _summarise_calendar(name, result_dict)
        else:
            # time, notify, memory tools: just record the call. They
            # don't carry conversational state ("go back to that
            # remember_note" isn't a real follow-up shape).
            summary = _summarise_generic(name, result_dict)
    except Exception as exc:  # pragma: no cover - defensive
        # Never let context-tracking failures break the tool path.
        summary = f"{name}: context update failed ({type(exc).__name__})"

    ctx.add_tool_call(name=name, args=args, result_summary=summary)
