"""Test suite for the voice tool auto-discovery registry."""
import sys
from pathlib import Path

# Add the parent directory to the path to allow importing just the tools module
# without triggering the full raven_core import chain (which requires pyaudio, etc.)
raven_core_path = Path(__file__).parent.parent
sys.path.insert(0, str(raven_core_path))

# Mock the session_context module to avoid deep import dependencies
import unittest.mock as mock
sys.modules['raven_core.session_context'] = mock.MagicMock()

import pytest
from raven_core.tools import (
    _TOOL_MODULES,
    get_all_tool_declarations,
    get_registered_functions,
)


def test_registry_discovers_expected_modules():
    """Verify the registry discovers all expected tool modules."""
    # Extract module names from the discovered modules
    module_names = {mod.__name__.split(".")[-1] for mod in _TOOL_MODULES}

    # Expected modules based on PR #56 baseline
    expected = {
        "time_tool",
        "memory_tool",
        "notify_tool",
        "news_tool",
        "finance_tool",
        "digest_tool",
        "weather_tool",
        "calendar_tool",
        "reminders_tool",
        "system_info_tool",
    }

    # Verify all expected modules are discovered
    assert expected.issubset(module_names), (
        f"Missing expected modules: {expected - module_names}"
    )


def test_registry_excludes_disabled_modules():
    """Verify disabled modules (cerebras, silence, system) are not auto-discovered."""
    module_names = {mod.__name__.split(".")[-1] for mod in _TOOL_MODULES}

    # These modules are vendored but should NOT be registered
    disabled = {"cerebras_tool", "silence_tool", "system_tool"}

    # Verify none of the disabled modules are present
    assert disabled.isdisjoint(module_names), (
        f"Disabled modules should not be registered: {disabled & module_names}"
    )


def test_all_modules_have_required_exports():
    """Verify every discovered module has get_tools and a handler."""
    for module in _TOOL_MODULES:
        # Must have get_tools
        assert hasattr(module, "get_tools"), (
            f"{module.__name__} missing get_tools()"
        )
        assert callable(module.get_tools), (
            f"{module.__name__}.get_tools is not callable"
        )

        # Must have at least one handler
        has_sync = hasattr(module, "handle_call") and callable(module.handle_call)
        has_async = hasattr(module, "handle_call_async") and callable(module.handle_call_async)
        assert has_sync or has_async, (
            f"{module.__name__} missing both handle_call and handle_call_async"
        )


def test_get_all_tool_declarations_returns_tools():
    """Verify get_all_tool_declarations() aggregates tool declarations."""
    tools = get_all_tool_declarations()

    # Should return a non-empty list
    assert isinstance(tools, list), "get_all_tool_declarations should return a list"
    assert len(tools) > 0, "Registry should discover at least one tool"

    # Each item should be a types.Tool
    from google.genai import types
    for tool in tools:
        assert isinstance(tool, types.Tool), f"Expected types.Tool, got {type(tool)}"


def test_get_registered_functions_returns_function_names():
    """Verify get_registered_functions() returns a list of function names."""
    functions = get_registered_functions()

    # Should return a non-empty list
    assert isinstance(functions, list), "get_registered_functions should return a list"
    assert len(functions) > 0, "Registry should have at least one function"

    # All items should be strings
    for func_name in functions:
        assert isinstance(func_name, str), f"Expected string, got {type(func_name)}"


def test_registry_order_is_stable():
    """Verify the registry order is stable (alphabetical by module name)."""
    module_names = [mod.__name__.split(".")[-1] for mod in _TOOL_MODULES]

    # The list should be sorted alphabetically
    assert module_names == sorted(module_names), (
        "Tool modules should be sorted alphabetically for stable ordering"
    )
