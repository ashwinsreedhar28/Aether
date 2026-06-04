"""Navigate Tool - Switch the user's Dashboard view.

raven's second SIDE-EFFECT-WITH-ACK tool, and the THINNEST one. Where
visualize_tool POSTs a panel through the visualizer Mixer over the mesh
(``raven → visualizer.render``), navigate makes NO mesh call at all: it
validates a requested view name and returns it. The renderer's existing
tool-call subscription — the same ``voice:tool-call`` push that EVERY
tool already rides — reads the returned view and flips the Shell's
active view. Zero new transport, zero new manifest edge.

The four views mirror shell/src/dashboard/Shell.tsx's ``View`` union
exactly: 'scene' (the ambient panel home), 'chats', 'mesh' (the live
topology instrument), and 'lanes' (the agent-visibility instrument).
These are INSTRUMENT VIEWS the user navigates between — categorically
distinct from the visualize tool's PANEL SUMMONS, which compose an
overlay onto the Scene. "show me the mesh" summons a panel (visualize);
"go to the mesh" flips the instrument view (navigate). The voice prompt
keeps the two apart by verb.

Like visualize, the return is a tiny ACK SIGNAL, not content to read
aloud — raven must not narrate the destination view's contents.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

FUNCTIONS = ["navigate"]

# Must stay in lockstep with the View union in
# shell/src/dashboard/Shell.tsx. Adding a view there means adding it
# here (and vice versa); a navigate({view}) for a view the Shell can't
# render would ack but visibly no-op. The renderer also re-validates
# against its own tab set, so a drift here fails safe (no switch).
VALID_VIEWS = ("scene", "chats", "mesh", "lanes")


def _navigate(view: str) -> dict[str, Any]:
    view = (view or "").strip().lower()
    if view not in VALID_VIEWS:
        # Tiny error signal — raven says it couldn't switch rather than
        # acking a no-op. No `view` key on the failure path, so the
        # renderer naturally ignores it.
        return {"error": "unknown_view", "requested": view}
    return {"ok": True, "view": view}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declaration for navigate."""
    func = types.FunctionDeclaration(
        name="navigate",
        description=(
            "Switch the user's Dashboard to one of its instrument VIEWS. "
            "This is a SIDE-EFFECT tool: it changes which view fills the "
            "screen and returns only a success/failure signal — it does "
            "NOT return content to read aloud. After calling it, speak a "
            "one- or two-word acknowledgment only ('Lanes, sir.'); never "
            "describe the view's contents. Valid views: 'scene' (the "
            "ambient panel home), 'chats', 'mesh' (the live topology "
            "view), 'lanes' (the active development lanes). Use when the "
            "user asks to OPEN, GO TO, or SWITCH TO a view. Distinct from "
            "the visualize tool, which summons a panel OVERLAY ('show me "
            "the mesh'); navigate flips the whole view ('go to the mesh')."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "view": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Which view to switch to. One of: 'scene', "
                        "'chats', 'mesh', 'lanes'."
                    ),
                ),
            },
            required=["view"],
        ),
    )
    return [types.Tool(function_declarations=[func])]


def handle_call(name: str, args: dict) -> dict[str, Any] | None:
    """Sync tool handler — navigate does no I/O and makes no mesh call."""
    if name == "navigate":
        return _navigate(view=args.get("view", ""))
    return None
