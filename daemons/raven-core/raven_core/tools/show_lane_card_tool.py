"""Show Lane Card Tool - Raise a specific lane's spawn card by voice.

The summon half of #305 ("show me lane 219's card"). One ``mesh_invoke`` to
``viewer_desktop.show_lane_card`` (the edge ``raven →
viewer_desktop.show_lane_card`` in manifest.yaml authorises the hop); the
renderer resolves the number to a spawn record — issue number / branch, the
same matcher behind the clickable Lanes rows — and raises its SpawnApproval
card, mark-complete / cleanup block and all.

A SIDE-EFFECT tool like work_on_issue: the card raise is the artifact, the
return is a tiny signal, and raven speaks ONE line. It never reads the card's
content aloud — the Director is looking at it. Distinct from work_on_issue
(ARMS a new lane) and open_app('lanes') (opens the worktree LIST): this raises
ONE record's card.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["show_lane_card"]


def _normalize_number(value: Any) -> int | None:
    """Coerce the spoken lane number to a positive int; None = unusable."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 1:
        return value
    if isinstance(value, float) and value.is_integer() and value >= 1:
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


async def _show_lane_card(number: Any) -> dict[str, Any]:
    n = _normalize_number(number)
    if n is None:
        return {"ok": False, "error": "no usable lane number"}
    try:
        response = await mesh_invoke("viewer_desktop.show_lane_card", {"number": n})
    except MeshUnavailable as e:
        return {"error": "viewer unavailable", "detail": str(e)}
    if not response.get("ok", False):
        # Structured miss from the renderer ("no spawn record for lane N") —
        # relay it; the number was probably mis-heard or the lane pre-dates
        # the ledger.
        return {"ok": False, "number": n, "error": response.get("error") or "card raise failed"}
    return {"ok": True, "number": n, "status": response.get("status")}


_DESCRIPTION = (
    "RAISE the spawn card for one lane on the desktop: 'show me lane 219's "
    "card' / 'pull up lane 305' / 'bring up the spawn card for 232'. Takes "
    "the lane's issue number; the shell finds that lane's spawn record and "
    "raises its approval/active/cleanup card. A SIDE-EFFECT tool: it shows "
    "the card and returns a tiny signal, NOT content to read aloud — say one "
    "line ('On screen, sir.'). { ok: false, error } means no record matched "
    "(mis-heard number, or the lane pre-dates the ledger) — relay briefly. "
    "Distinct from work_on_issue / spawn_lane (ARMS a NEW lane) and from "
    "open_app('lanes') (opens the worktree LIST app): use THIS when the user "
    "wants one specific lane's card."
)

_PARAMETERS = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "number": types.Schema(
            type=types.Type.INTEGER,
            description="The lane's issue number ('show me lane 219's card' → 219).",
        ),
    },
    required=["number"],
)


def get_tools() -> list[types.Tool]:
    """Return the Gemini function declaration for show_lane_card."""
    show_lane_card = types.FunctionDeclaration(
        name="show_lane_card",
        description=_DESCRIPTION,
        parameters=_PARAMETERS,
    )
    return [types.Tool(function_declarations=[show_lane_card])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — the card raise rides the mesh."""
    if name in FUNCTIONS:
        return await _show_lane_card(number=args.get("number"))
    return None
