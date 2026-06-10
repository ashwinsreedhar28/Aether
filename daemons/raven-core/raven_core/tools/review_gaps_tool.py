"""Review Gaps Tool - Read back the recorded gap log so Aether can propose
what to build next.

The read-side counterpart to ``report_gap``. Where ``report_gap`` WRITES one
gap when raven hits a request it can't fulfil, ``review_gaps`` READS the whole
recent gap log back so raven can cluster the gaps and pitch concrete next
builds — the first brick of the Architect era. It invokes ``intents.list``
through ``mesh_client.mesh_invoke``; the edge ``raven → intents.list`` in
manifest.yaml authorises the hop (raven's read relationship to intents, added
alongside its existing ``raven → intents.record`` write edge).

UNLIKE report_gap — a SIDE-EFFECT tool that returns a tiny
ack — this tool RETURNS CONTENT: the gap records, for raven to reason over.
raven reads them, clusters related ones, and proposes 1–3 lanes. It does NOT
build anything; proposing is the whole job, and building stays human-gated.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["review_gaps"]

# How many gaps to pull for a review. The log is low-frequency and append-only
# (newest-first from intents.list); ~50 is plenty of material to cluster a few
# proposals from without flooding the model. Fixed rather than a tool param —
# raven never needs to choose a window to answer "what should we build next".
REVIEW_LIMIT = 50


async def _review_gaps() -> dict[str, Any]:
    try:
        # OPEN gaps only: a proposal should pitch what's still missing, not
        # re-pitch capabilities already built (intents.list defaults to open, but
        # we pass it explicitly so the intent survives any future default change).
        response = await mesh_invoke("intents.list", {"limit": REVIEW_LIMIT, "status": "open"})
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    # intents.list returns { gaps: [{ id, ts, text, context }] } newest-first.
    # Surface a MeshDeny-shaped error dict rather than acking a no-op so raven
    # can say it couldn't review the log. On success pass the gaps through as
    # the node returned them (thin) plus a count — this IS content for raven to
    # cluster and pitch from, not a signal to ack.
    if isinstance(response, dict) and response.get("error"):
        return {"error": "review failed", "detail": str(response.get("error"))}
    gaps = response.get("gaps") or []
    return {"ok": True, "gaps": gaps, "count": len(gaps)}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declaration for review_gaps."""
    func = types.FunctionDeclaration(
        name="review_gaps",
        description=(
            "Read back the OPEN capability-gap log — the things the user asked "
            "for that Aether still cannot do (already-closed gaps are excluded) "
            "— so you can propose what to build next. UNLIKE report_gap, "
            "this RETURNS the "
            "gaps for you to reason over (cluster related ones and pitch "
            "concrete lanes); it is NOT a side-effect tool and its result is "
            "content, not an ack. Call it when the user asks a forward-looking "
            "build question — 'what should we build next', 'propose "
            "improvements', 'review your gaps and suggest something'. Then "
            "cluster the returned gaps into 1–3 short, concrete proposals and "
            "speak them briefly. You PROPOSE only; you do not build anything."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},
            required=[],
        ),
    )
    return [types.Tool(function_declarations=[func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "review_gaps":
        return await _review_gaps()
    return None
