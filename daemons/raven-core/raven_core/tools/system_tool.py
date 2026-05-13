"""
System Tool - OS control functions (open apps, URLs, set visual mode).
"""

import subprocess
import webbrowser
from pathlib import Path
from typing import Any, Callable

from google.genai import types

FUNCTIONS = ["open_url", "open_app", "set_visual_mode"]

# Default allowed apps whitelist
DEFAULT_ALLOWED_APPS = [
    "Terminal",
    "iTerm",
    "VS Code",
    "Visual Studio Code",
    "Code",
    "Chrome",
    "Google Chrome",
    "Safari",
    "Firefox",
    "Finder",
    "Slack",
    "Spotify",
    "Notes",
    "Calendar",
    "Notion",
    "Discord",
    "Messages",
    "Mail",
    "Preview",
    "TextEdit",
    "Activity Monitor",
    "System Preferences",
    "System Settings",
]

# Callback for visual mode changes (set by orchestrator)
_visual_mode_callback: Callable[[str], None] | None = None


def set_visual_mode_callback(callback: Callable[[str], None]) -> None:
    """Set the callback function for visual mode changes."""
    global _visual_mode_callback
    _visual_mode_callback = callback


def _load_allowed_apps() -> list[str]:
    """Load allowed apps from config or use defaults."""
    import json

    config_path = Path.home() / ".raven" / "config.json"
    if config_path.exists():
        try:
            with open(config_path, "r") as f:
                config = json.load(f)
                return config.get("allowed_apps", DEFAULT_ALLOWED_APPS)
        except (json.JSONDecodeError, KeyError):
            pass
    return DEFAULT_ALLOWED_APPS


def open_url(url: str) -> dict[str, Any]:
    """
    Open a URL in the default web browser.

    Args:
        url: The URL to open

    Returns:
        Status of the operation
    """
    try:
        # Ensure URL has a scheme
        if not url.startswith(("http://", "https://")):
            url = "https://" + url

        webbrowser.open(url)
        print(f"[SYSTEM] Opened URL: {url}")
        return {"status": "success", "message": f"Opened {url}"}
    except Exception as e:
        print(f"[SYSTEM] Error opening URL: {e}")
        return {"status": "error", "message": str(e)}


def open_app(app_name: str) -> dict[str, Any]:
    """
    Open an application by name (macOS only, whitelisted apps).

    Args:
        app_name: Name of the application to open

    Returns:
        Status of the operation
    """
    allowed_apps = _load_allowed_apps()

    # Check if app is in whitelist (case-insensitive)
    app_lower = app_name.lower()
    is_allowed = any(app.lower() == app_lower for app in allowed_apps)

    if not is_allowed:
        print(f"[SYSTEM] App not in whitelist: {app_name}")
        return {
            "status": "error",
            "message": f"'{app_name}' is not in the allowed apps list. "
            f"Allowed apps: {', '.join(allowed_apps[:5])}...",
        }

    try:
        # macOS: use 'open -a' command
        subprocess.run(
            ["open", "-a", app_name],
            check=True,
            capture_output=True,
        )
        print(f"[SYSTEM] Opened app: {app_name}")
        return {"status": "success", "message": f"Opened {app_name}"}
    except subprocess.CalledProcessError as e:
        error_msg = e.stderr.decode() if e.stderr else str(e)
        print(f"[SYSTEM] Error opening app: {error_msg}")
        return {"status": "error", "message": f"Failed to open {app_name}: {error_msg}"}
    except Exception as e:
        print(f"[SYSTEM] Error: {e}")
        return {"status": "error", "message": str(e)}


def set_visual_mode(mode: str) -> dict[str, Any]:
    """
    Set the visual input mode (camera, screen, or none).

    Args:
        mode: One of 'camera', 'screen', or 'none'

    Returns:
        Status of the operation
    """
    valid_modes = ["camera", "screen", "none"]
    mode = mode.lower()

    if mode not in valid_modes:
        return {
            "status": "error",
            "message": f"Invalid mode '{mode}'. Must be one of: {valid_modes}",
        }

    if _visual_mode_callback:
        _visual_mode_callback(mode)
        print(f"[SYSTEM] Visual mode set to: {mode}")
        return {"status": "success", "message": f"Visual mode set to {mode}"}
    else:
        print("[SYSTEM] Visual mode callback not set")
        return {
            "status": "error",
            "message": "Visual mode cannot be changed during this session",
        }


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for system tool."""
    open_url_func = types.FunctionDeclaration(
        name="open_url",
        description=(
            "Open a URL in the user's default web browser. "
            "Use this when the user asks to open a website or link."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "url": types.Schema(
                    type=types.Type.STRING,
                    description="The URL to open (e.g., 'google.com' or 'https://example.com')",
                ),
            },
            required=["url"],
        ),
    )

    open_app_func = types.FunctionDeclaration(
        name="open_app",
        description=(
            "Open an application on the user's computer. "
            "Use this when the user asks to open or launch an app like Chrome, Slack, Spotify, etc. "
            "Only whitelisted apps can be opened for security."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "app_name": types.Schema(
                    type=types.Type.STRING,
                    description="The name of the application to open (e.g., 'Chrome', 'Slack', 'Spotify')",
                ),
            },
            required=["app_name"],
        ),
    )

    set_visual_func = types.FunctionDeclaration(
        name="set_visual_mode",
        description=(
            "Change what visual input RAVEN receives. "
            "'camera' shows the webcam feed, 'screen' shows screen capture, 'none' disables visual input. "
            "Use this when the user wants to share their screen, show the camera, or stop sharing."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "mode": types.Schema(
                    type=types.Type.STRING,
                    description="The visual mode: 'camera', 'screen', or 'none'",
                ),
            },
            required=["mode"],
        ),
    )

    return [
        types.Tool(function_declarations=[open_url_func]),
        types.Tool(function_declarations=[open_app_func]),
        types.Tool(function_declarations=[set_visual_func]),
    ]


def handle_call(name: str, args: dict) -> dict[str, Any] | None:
    """Handle function calls for system tool."""
    if name == "open_url":
        url = args.get("url", "")
        return open_url(url)
    elif name == "open_app":
        app_name = args.get("app_name", "")
        return open_app(app_name)
    elif name == "set_visual_mode":
        mode = args.get("mode", "")
        return set_visual_mode(mode)
    return None
