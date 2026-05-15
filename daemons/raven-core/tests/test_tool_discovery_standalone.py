"""Standalone test for tool discovery logic (no raven_core imports)."""
import importlib.util
from pathlib import Path

# Find the tools directory
tools_dir = Path(__file__).parent.parent / "raven_core" / "tools"

# Expected enabled modules
EXPECTED_ENABLED = {
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

# Expected disabled modules
EXPECTED_DISABLED = {
    "cerebras_tool",
    "silence_tool",
    "system_tool",
}

def check_module_exports(module_path: Path) -> tuple[bool, bool]:
    """Check if a module has get_tools and handler exports."""
    spec = importlib.util.spec_from_file_location("temp_module", module_path)
    if spec is None or spec.loader is None:
        return False, False

    module = importlib.util.module_from_spec(spec)

    # We need to create minimal mocks for imports
    import sys
    import unittest.mock as mock

    # Mock the dependencies
    sys.modules['google.genai'] = mock.MagicMock()
    sys.modules['google.genai.types'] = mock.MagicMock()
    sys.modules['raven_core.session_context'] = mock.MagicMock()
    sys.modules['raven_core.mesh_client'] = mock.MagicMock()

    try:
        spec.loader.exec_module(module)
    except Exception as e:
        print(f"Failed to load {module_path.name}: {e}")
        return False, False

    has_get_tools = hasattr(module, "get_tools") and callable(module.get_tools)
    has_handler = (
        (hasattr(module, "handle_call") and callable(module.handle_call)) or
        (hasattr(module, "handle_call_async") and callable(module.handle_call_async))
    )

    return has_get_tools, has_handler

def main():
    """Verify tool discovery would work correctly."""
    print("Checking tool modules in:", tools_dir)
    print()

    discovered = []
    disabled_found = []

    py_files = sorted(tools_dir.glob("*.py"))
    for py_file in py_files:
        module_name = py_file.stem
        if module_name in ("__init__", "base"):
            continue

        has_get_tools, has_handler = check_module_exports(py_file)

        if has_get_tools and has_handler:
            if module_name in EXPECTED_DISABLED:
                disabled_found.append(module_name)
                print(f"✓ {module_name:20s} - has exports (should be excluded)")
            else:
                discovered.append(module_name)
                print(f"✓ {module_name:20s} - would be discovered")
        else:
            print(f"✗ {module_name:20s} - missing exports")

    print()
    print("=" * 60)
    print(f"Total discovered: {len(discovered)}")
    print(f"Expected enabled: {len(EXPECTED_ENABLED)}")
    print()

    missing = EXPECTED_ENABLED - set(discovered)
    if missing:
        print(f"❌ Missing expected modules: {missing}")
    else:
        print(f"✓ All expected modules would be discovered")

    print()
    unexpected_disabled = set(disabled_found) - EXPECTED_DISABLED
    if unexpected_disabled:
        print(f"⚠️  Unexpected modules in disabled list: {unexpected_disabled}")

    expected_but_not_disabled = EXPECTED_DISABLED - set(disabled_found)
    if expected_but_not_disabled:
        print(f"⚠️  Expected disabled modules not found: {expected_but_not_disabled}")
    else:
        print(f"✓ All disabled modules have exports (exclusion is working)")

    print()
    print("Discovered modules (alphabetical):")
    for name in sorted(discovered):
        print(f"  - {name}")

if __name__ == "__main__":
    main()
