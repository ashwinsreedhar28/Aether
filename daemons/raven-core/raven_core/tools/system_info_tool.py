"""Voice tools for system_info node.

Surfaces macOS system context (battery, disk, network, active app) via
the mesh. See nodes/system_info/ for the surface implementations.
"""

from raven_core.mesh import mesh_invoke


async def system_battery() -> str:
    """Report the laptop's current battery status."""
    result = await mesh_invoke("system_info.battery", {})
    if not result.get("available"):
        reason = result.get("reason", "unavailable")
        if reason == "no_battery_found":
            return "No battery detected — this looks like a desktop."
        return "Battery status isn't available right now, sir."
    percent = result["percent"]
    charging = result.get("is_charging", False)
    state = "charging" if charging else "on battery"
    remaining = result.get("time_remaining_minutes")
    suffix = f", about {remaining} minutes remaining" if remaining else ""
    return f"Battery at {percent}%, {state}{suffix}."


async def system_disk() -> str:
    """Report root disk usage."""
    result = await mesh_invoke("system_info.disk", {})
    if not result.get("available"):
        return "Disk usage isn't available right now, sir."
    rd = result["root_disk"]
    return f"{rd['free_gb']:.0f} GB free of {rd['total_gb']:.0f} GB on the root disk, {rd['used_pct']:.0f}% used."


async def system_network() -> str:
    """Report current WiFi / network status."""
    result = await mesh_invoke("system_info.network", {})
    if not result.get("available"):
        return "Network status isn't available right now, sir."
    wifi = result.get("wifi") or {}
    ssid = wifi.get("ssid")
    signal = wifi.get("signal_dbm")
    if ssid:
        if signal is not None:
            return f"Connected to {ssid}, signal {signal} dBm."
        return f"Connected to {ssid}."
    return "Not connected to WiFi."


async def system_active_app() -> str:
    """Report the currently focused application."""
    result = await mesh_invoke("system_info.active_app", {})
    if not result.get("available"):
        return "Active app isn't available right now, sir."
    app_name = result.get("app_name", "unknown")
    return f"Currently focused on {app_name}."
