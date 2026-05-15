"""Voice tools for reminders node.

Reads from macOS Reminders.app via the mesh. See nodes/reminders/ for
the surface implementations.
"""

from raven_core.mesh import mesh_invoke


async def reminders_due_today() -> str:
    """Speak the user's reminders due today."""
    result = await mesh_invoke("reminders.due_today", {})
    if not result.get("available"):
        reason = result.get("reason", "unavailable")
        if reason == "permission_denied":
            return "Reminders access isn't granted yet, sir."
        if reason == "framework_unavailable":
            return "Reminders aren't available on this system."
        return "Reminders aren't available right now, sir."
    items = result.get("reminders", [])
    if not items:
        return "Nothing due today."
    if len(items) == 1:
        return f"One reminder due today: {items[0]['title']}."
    titles = ", ".join(r["title"] for r in items[:5])
    if len(items) <= 5:
        return f"{len(items)} reminders due today: {titles}."
    return f"{len(items)} reminders due today, starting with: {titles}, and {len(items) - 5} more."


async def reminders_overdue() -> str:
    """Speak overdue reminders (past due date, still incomplete)."""
    result = await mesh_invoke("reminders.overdue", {})
    if not result.get("available"):
        reason = result.get("reason", "unavailable")
        if reason == "permission_denied":
            return "Reminders access isn't granted yet, sir."
        return "Reminders aren't available right now, sir."
    items = result.get("reminders", [])
    if not items:
        return "Nothing overdue."
    if len(items) == 1:
        return f"One overdue reminder: {items[0]['title']}."
    titles = ", ".join(r["title"] for r in items[:5])
    if len(items) <= 5:
        return f"{len(items)} overdue: {titles}."
    return f"{len(items)} overdue, starting with: {titles}, and {len(items) - 5} more."


async def reminders_upcoming(limit: int = 10) -> str:
    """Speak the next N upcoming reminders."""
    result = await mesh_invoke("reminders.upcoming", {"limit": limit})
    if not result.get("available"):
        reason = result.get("reason", "unavailable")
        if reason == "permission_denied":
            return "Reminders access isn't granted yet, sir."
        return "Reminders aren't available right now, sir."
    items = result.get("reminders", [])
    if not items:
        return "No upcoming reminders."
    titles = ", ".join(r["title"] for r in items[:5])
    if len(items) <= 5:
        return f"Upcoming reminders: {titles}."
    return f"Upcoming reminders include: {titles}, and {len(items) - 5} more."
