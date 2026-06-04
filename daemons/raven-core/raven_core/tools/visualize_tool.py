"""Visualize Tool - Summon a visualization panel onto the user's screen.

raven's first SIDE-EFFECT-WITH-ACK tool. Every other voice tool returns
data for raven to read aloud (headlines, prices, a digest paragraph).
This one is categorically different: its effect is a panel APPEARING on
the user's Dashboard, composed and POSTed by the visualizer Mixer. The
tool returns a tiny success/failure signal — NOT content to narrate.

The implementation invokes ``visualizer.render`` through
``mesh_client.mesh_invoke`` rather than rendering anything itself. The
edge ``raven → visualizer.render`` in manifest.yaml authorises the hop;
without it Core would reject the envelope.

The visualizer's render surface is intent-routed and the tool mirrors
that shape (an optional ``intent`` param defaulting to ``mesh``). Voice-
summonable intents: ``mesh`` (topology), ``lanes`` (dev lanes), ``gaps``
(capability gaps), ``agenda`` (today/tomorrow calendar). Each is wired in
the system prompt with a "show me / bring up / pull up" trigger. Do NOT
narrate the panel's contents; the panel speaks for itself visually.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["visualize"]

# 'mesh' is the default for a bare visualize() call. The visualizer also
# accepts 'dashboard', but that is the auto-seeded backdrop (not voice-
# summonable). Voice-summonable intents (mesh/lanes/gaps/agenda) are each
# passed explicitly by raven per the system prompt; this default only
# covers an intent-less call.
DEFAULT_INTENT = "mesh"


async def _visualize(intent: str) -> dict[str, Any]:
    intent = (intent or DEFAULT_INTENT).strip() or DEFAULT_INTENT

    try:
        response = await mesh_invoke(
            "visualizer.render",
            {"intent": intent},
        )
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    # visualizer.render returns { ok: true, intent, panels } on success.
    # An unknown intent comes back as a MeshDeny-shaped error dict; surface
    # it so raven can say it couldn't bring up the panel rather than acking
    # a no-op. Either way the return is a tiny ACK SIGNAL, not content —
    # raven must not read the panel's nodes/edges aloud.
    if isinstance(response, dict) and response.get("error"):
        return {"error": "render failed", "detail": str(response.get("error"))}
    return {"ok": True, "intent": intent}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declaration for visualize."""
    func = types.FunctionDeclaration(
        name="visualize",
        description=(
            "Summon a visualization panel onto the user's Dashboard. This "
            "is a SIDE-EFFECT tool: it makes a panel APPEAR on screen and "
            "returns only a success/failure signal — it does NOT return "
            "content to read aloud. After calling it, speak a brief "
            "acknowledgment only; never enumerate the panel's contents "
            "(nodes, edges, counts). Supported intents: 'mesh' (live mesh "
            "topology), 'lanes' (active development lanes), 'gaps' (recorded "
            "capability gaps), 'agenda' (the user's calendar — today and "
            "tomorrow, time-ordered). Use whenever the user asks to SEE or "
            "SHOW one of these: 'show me the mesh', 'show me my lanes', 'show "
            "me your gaps', and 'show me my agenda' / 'bring up my agenda' / "
            "'pull up my calendar' (intent 'agenda'). Pass the matching "
            "intent. The 'agenda' intent DISPLAYS the calendar panel and is "
            "distinct from calendar_today, which READS events aloud — a SHOW "
            "request summons the panel, it does not read the schedule."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "intent": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "What to visualize: 'mesh' (live mesh topology), "
                        "'lanes' (development lanes), 'gaps' (capability "
                        "gaps), or 'agenda' (today/tomorrow calendar). "
                        "Defaults to 'mesh' if omitted."
                    ),
                ),
            },
            required=[],
        ),
    )
    return [types.Tool(function_declarations=[func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "visualize":
        return await _visualize(intent=args.get("intent", DEFAULT_INTENT))
    return None
