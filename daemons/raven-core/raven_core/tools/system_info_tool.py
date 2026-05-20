"""System Info Tool - macOS system status readbacks via the mesh.

Five tools, all routed through ``mesh_invoke`` to the system_info node:

  - ``system_battery()``                   → ``system_info.battery()``
  - ``system_disk()``                      → ``system_info.disk()``
  - ``system_network()``                   → ``system_info.network()``
  - ``system_active_app()``                → ``system_info.active_app()``
  - ``system_processes(limit?, sort_by?)`` → ``system_info.processes(...)``

Pattern matches calendar_tool / news_tool / finance_tool: declare the
function for Gemini, implement as a thin ``await mesh_invoke(...)``,
add edges in manifest.yaml. Each surface returns a different shape, so
each tool has its own formatting logic.

Battery/disk/network are obtained via shell commands (pmset, df,
networksetup, wdutil). Active app requires Automation permission for
System Events (prompted on first call via osascript). Processes are
obtained via ps and sorted by CPU% or memory.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = [
    "system_battery",
    "system_disk",
    "system_network",
    "system_active_app",
    "system_processes",
]


async def _system_battery() -> dict[str, Any]:
    """Fetch laptop battery state."""
    try:
        response = await mesh_invoke("system_info.battery", {})
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    if not isinstance(response, dict):
        return {"error": "malformed response"}

    available = response.get("available", False)
    if not available:
        reason = response.get("reason", "unknown")
        if reason == "no_battery_found":
            return {
                "error": "no_battery",
                "spoken": "No battery detected — this looks like a desktop."
            }
        return {
            "error": "unavailable",
            "spoken": "Battery status isn't available right now, sir.",
            "detail": reason,
        }

    percent = response.get("percent", 0)
    is_charging = response.get("is_charging", False)
    time_remaining = response.get("time_remaining_minutes")
    cycle_count = response.get("cycle_count")

    state = "charging" if is_charging else "on battery"
    suffix = ""
    if time_remaining and time_remaining > 0:
        if time_remaining >= 60:
            hours = time_remaining // 60
            minutes = time_remaining % 60
            if minutes == 0:
                suffix = f", about {hours} {'hour' if hours == 1 else 'hours'} remaining"
            else:
                suffix = f", about {hours} {'hour' if hours == 1 else 'hours'} and {minutes} minutes remaining"
        else:
            suffix = f", about {time_remaining} minutes remaining"

    spoken = f"Battery at {percent}%, {state}{suffix}, sir."

    return {
        "percent": percent,
        "is_charging": is_charging,
        "time_remaining_minutes": time_remaining,
        "cycle_count": cycle_count,
        "spoken": spoken,
    }


async def _system_disk() -> dict[str, Any]:
    """Fetch root disk usage."""
    try:
        response = await mesh_invoke("system_info.disk", {})
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    if not isinstance(response, dict):
        return {"error": "malformed response"}

    available = response.get("available", False)
    if not available:
        return {
            "error": "unavailable",
            "spoken": "Disk usage isn't available right now, sir.",
        }

    root_disk = response.get("root_disk", {})
    total_gb = root_disk.get("total_gb", 0)
    free_gb = root_disk.get("free_gb", 0)
    used_pct = root_disk.get("used_pct", 0)

    spoken = (
        f"{free_gb:.0f} gigabytes free of {total_gb:.0f} total on the root disk, "
        f"{used_pct:.0f}% used, sir."
    )

    return {
        "total_gb": total_gb,
        "free_gb": free_gb,
        "used_pct": used_pct,
        "spoken": spoken,
    }


async def _system_network() -> dict[str, Any]:
    """Fetch current network / WiFi status."""
    try:
        response = await mesh_invoke("system_info.network", {})
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    if not isinstance(response, dict):
        return {"error": "malformed response"}

    available = response.get("available", False)
    if not available:
        return {
            "error": "unavailable",
            "spoken": "Network status isn't available right now, sir.",
        }

    wifi = response.get("wifi") or {}
    ssid = wifi.get("ssid")
    signal_dbm = wifi.get("signal_dbm")
    link_rate = wifi.get("link_rate_mbps")
    active_interface = response.get("active_interface")
    ip = response.get("ip")

    if ssid:
        parts = [f"Connected to {ssid}"]
        if signal_dbm is not None:
            parts.append(f"signal {signal_dbm} dBm")
        if link_rate:
            parts.append(f"link rate {link_rate} megabits per second")
        spoken = ", ".join(parts) + ", sir."
    else:
        spoken = "Not connected to WiFi, sir."

    return {
        "wifi": wifi,
        "active_interface": active_interface,
        "ip": ip,
        "spoken": spoken,
    }


async def _system_active_app() -> dict[str, Any]:
    """Fetch the currently focused application."""
    try:
        response = await mesh_invoke("system_info.active_app", {})
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    if not isinstance(response, dict):
        return {"error": "malformed response"}

    available = response.get("available", False)
    if not available:
        reason = response.get("reason", "unknown")
        if reason == "permission_denied":
            return {
                "error": "permission_denied",
                "spoken": (
                    "Active app detection needs Automation access, sir. Please "
                    "grant it in System Settings, under Privacy and Security, "
                    "then Automation."
                ),
            }
        return {
            "error": "unavailable",
            "spoken": "Active app isn't available right now, sir.",
        }

    app_name = response.get("app_name", "unknown")
    window_title = response.get("window_title")

    spoken = f"Currently focused on {app_name}, sir."

    return {
        "app_name": app_name,
        "window_title": window_title,
        "spoken": spoken,
    }


async def _system_processes(limit: int, sort_by: str) -> dict[str, Any]:
    """Fetch top processes by CPU or memory."""
    clamped = max(1, min(limit, 20))
    sort_key = sort_by if sort_by in ("cpu", "memory") else "cpu"

    try:
        response = await mesh_invoke(
            "system_info.processes",
            {"limit": clamped, "sort_by": sort_key},
        )
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    if not isinstance(response, dict):
        return {"error": "malformed response"}

    available = response.get("available", True)
    if not available:
        return {
            "error": "unavailable",
            "spoken": "Process information isn't available right now, sir.",
        }

    processes = response.get("processes", [])
    if not processes:
        return {
            "processes": [],
            "spoken": "Nothing notable in process activity, sir.",
        }

    top = processes[:5]
    lines: list[str] = []
    for p in top:
        raw_name = p.get("command") or "unknown"
        # ps -axo comm can return paths like '/sbin/launchd'; use the leaf
        # for cleaner voice output.
        if "/" in raw_name:
            raw_name = raw_name.rsplit("/", 1)[-1]
        name = raw_name[:30]
        if sort_key == "cpu":
            value = p.get("cpu_pct", 0)
            lines.append(f"{name} at {value:.1f}% CPU")
        else:
            value = p.get("mem_pct", 0)
            lines.append(f"{name} at {value:.1f}% memory")

    metric = "CPU" if sort_key == "cpu" else "memory"
    spoken = f"Top processes by {metric}, sir: " + "; ".join(lines)

    return {
        "processes": processes,
        "count": len(processes),
        "sort_by": sort_key,
        "spoken": spoken,
    }


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for all system_info tools."""
    battery_func = types.FunctionDeclaration(
        name="system_battery",
        description=(
            "Get the laptop's current battery status. Use when the user asks "
            "'what's my battery', 'how's my battery', 'how much battery do I "
            "have', 'am I charging'. Returns percent, is_charging, "
            "time_remaining_minutes, cycle_count. If no battery exists "
            "(desktop), returns a spoken 'no battery' message. Read the "
            "spoken field verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},
        ),
    )

    disk_func = types.FunctionDeclaration(
        name="system_disk",
        description=(
            "Get the root disk usage. Use when the user asks 'do I have disk "
            "space', 'how much free space', 'storage status', 'how full is my "
            "disk'. Returns total_gb, free_gb, used_pct for the root volume. "
            "Read the spoken field verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},
        ),
    )

    network_func = types.FunctionDeclaration(
        name="system_network",
        description=(
            "Get the current network / WiFi status. Use when the user asks "
            "'what's my wifi', 'am I connected', 'what network am I on', "
            "'how's my signal'. Returns wifi SSID, signal in dBm if available, "
            "link rate in Mbps, active interface, IP address. If not connected "
            "to WiFi, returns a spoken 'not connected' message. Read the "
            "spoken field verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},
        ),
    )

    active_app_func = types.FunctionDeclaration(
        name="system_active_app",
        description=(
            "Get the currently focused (frontmost) application. Use when the "
            "user asks 'what am I working on', 'what app am I in', 'what's "
            "focused', 'what application is active'. Returns the app name and "
            "window title if available. On first invocation, macOS prompts "
            "for Automation permission via System Events. If denied, returns "
            "a spoken 'access denied' message. Read the spoken field verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},
        ),
    )

    processes_func = types.FunctionDeclaration(
        name="system_processes",
        description=(
            "Get the top processes by CPU or memory usage. Use when the user "
            "asks 'what's hogging my CPU', 'what's eating my memory', 'top "
            "processes', 'what's running'. Returns a list of processes with "
            "name, cpu_pct, memory_mb, sorted by the requested key. Default "
            "sorts by CPU, default limit 5, max 20. Read the spoken field "
            "verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "limit": types.Schema(
                    type=types.Type.INTEGER,
                    description=(
                        "Optional number of top processes to return. "
                        "Default 5, clamped to 1-20."
                    ),
                ),
                "sort_by": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Sort key: 'cpu' (default) for CPU% or 'memory' "
                        "for memory_mb."
                    ),
                    enum=["cpu", "memory"],
                ),
            },
            required=[],
        ),
    )

    return [
        types.Tool(
            function_declarations=[
                battery_func, disk_func, network_func,
                active_app_func, processes_func,
            ]
        )
    ]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "system_battery":
        return await _system_battery()
    if name == "system_disk":
        return await _system_disk()
    if name == "system_network":
        return await _system_network()
    if name == "system_active_app":
        return await _system_active_app()
    if name == "system_processes":
        limit = args.get("limit", 5)
        if not isinstance(limit, int):
            limit = 5
        sort_by = args.get("sort_by", "cpu")
        if not isinstance(sort_by, str):
            sort_by = "cpu"
        return await _system_processes(limit, sort_by)
    return None
