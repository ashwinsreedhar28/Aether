"""Review Gaps Tool - Read the open gap board back so Aether can propose
what to build next.

The read-side counterpart to ``report_gap``. Where ``report_gap`` FILES one
gap issue when raven hits a request it can't fulfil, ``review_gaps`` READS
the open gap-labeled issues back from the board so raven can cluster them
and pitch concrete next builds — and it carries the "what can't you do yet"
voice affordance (#255 ruling 4). It invokes ``github.list_issues`` through
``mesh_client.mesh_invoke``; the edge ``raven → github.list_issues`` in
manifest.yaml authorises the hop (raven's read relationship to the board,
alongside its ``raven → github.create_issue`` write edge).

UNLIKE report_gap — a SIDE-EFFECT tool that returns a tiny ack — this tool
RETURNS CONTENT: the open gap issues, for raven to reason over. raven reads
them, clusters related ones, and proposes 1–3 lanes. It does NOT build
anything; proposing is the whole job, and building stays human-gated.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["review_gaps"]

# How many gap issues to pull for a review. The board is low-frequency
# (a human asking for things, deduped node-side); ~50 is plenty of
# material to cluster a few proposals from without flooding the model.
# Fixed rather than a tool param — raven never needs to choose a window
# to answer "what should we build next". Matches the surface's default;
# its max is 100.
REVIEW_LIMIT = 50


async def _review_gaps() -> dict[str, Any]:
    try:
        # Gap-labeled OPEN issues only: the surface always returns open
        # issues; the labels filter narrows to the gap board (the panel
        # shows the whole board — the voice review pitches capabilities).
        response = await mesh_invoke(
            "github.list_issues", {"labels": "gap", "limit": REVIEW_LIMIT}
        )
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    # github.list_issues returns { issues, fetched_at_ms, stale,
    # token_available } — issues newest-first, each { number, title,
    # labels, comments, created_at, url, ... }. token_available: false is
    # the degraded mode: an empty board would be a LIE there ("no gaps!"),
    # so surface it as an error raven can speak plainly.
    if not response.get("token_available", False):
        return {"error": "github token not configured — can't read the gap board"}

    gaps = response.get("issues") or []
    result: dict[str, Any] = {"ok": True, "gaps": gaps, "count": len(gaps)}
    if response.get("stale"):
        # Served from the last good fetch (GitHub unreachable just now).
        # Raven need not narrate it; kept for logs and honest counts.
        result["stale"] = True
    return result


def get_tools() -> list[types.Tool]:
    """Return Gemini function declaration for review_gaps."""
    func = types.FunctionDeclaration(
        name="review_gaps",
        description=(
            "Read back the OPEN gap issues from the board — the things the "
            "user asked for that Aether still cannot do (closed issues are "
            "excluded) — so you can propose what to build next. UNLIKE "
            "report_gap, this RETURNS the gaps for you to reason over "
            "(cluster related ones and pitch concrete lanes); it is NOT a "
            "side-effect tool and its result is content, not an ack. Call "
            "it when the user asks a forward-looking build question — "
            "'what should we build next', 'propose improvements' — or asks "
            "what you can't do yet ('what can't you do yet', 'what are "
            "your gaps'). Then cluster the returned gaps into 1–3 short, "
            "concrete proposals and speak them briefly; an issue's "
            "`comments` count is its demand signal (repeat asks land as "
            "+1 comments). You PROPOSE only; you do not build anything."
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
