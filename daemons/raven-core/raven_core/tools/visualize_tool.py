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

v1 is intent ``mesh`` only — "show me the mesh" summons the topology
overlay. The visualizer's render surface is intent-routed and the tool
mirrors that shape (an optional ``intent`` param defaulting to ``mesh``)
so it scales as intents grow, but the prompt only wires the mesh intent
into the voice path. Do NOT narrate the panel's contents; the panel
speaks for itself visually.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["visualize"]

# v1 voice path summons only the mesh-topology overlay. The visualizer
# accepts other intents (e.g. 'dashboard') but those are not voice-
# summonable yet — dashboard is the auto-seeded backdrop, not a spoken
# command. Default here keeps a bare visualize() call meaningful.
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
            "(nodes, edges, counts). Currently supports intent 'mesh', "
            "which summons the live mesh topology overlay. Use when the "
            "user asks to SEE or SHOW the mesh."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "intent": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "What to visualize. Currently 'mesh' (the live "
                        "mesh topology overlay). Defaults to 'mesh' if "
                        "omitted."
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
