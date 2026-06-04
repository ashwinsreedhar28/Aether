"""Close Gap Tool - Mark a recorded gap closed once the capability exists.

The lifecycle counterpart to ``report_gap``. Where ``report_gap`` WRITES a gap
when raven hits a request it can't fulfil, ``close_gap`` marks one (or several)
closed when the user says the capability now exists — "the email one is done",
"you can read mail now, mark that closed". It invokes ``intents.close`` through
``mesh_client.mesh_invoke``; the edge ``raven → intents.close`` in manifest.yaml
authorises the hop.

Selector: pass ``match`` (a short substring of the gap's text — the common case,
since raven knows what the gap was about, not its UUID) OR ``id`` if it happens
to have one. ``match`` closes EVERY open gap whose text contains the substring,
so "mark the mail gaps closed" can close both in one call.

UNLIKE report_gap (a pure side-effect ack), this returns a small ``count`` so
raven can confirm naturally — "Marked closed, sir." for one, "Closed two, sir."
for several, or a gentle "Nothing matched, sir." on a zero-count no-op. It does
NOT return content to read aloud; the count just shapes the acknowledgment.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["close_gap"]

# Mirrors nodes/intents/schemas/close.json bounds.
ID_MAX = 200
MATCH_MAX = 2000


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


async def _close_gap(gap_id: str | None, match: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    # id wins if both are given (matches the node's selector precedence).
    if gap_id and gap_id.strip():
        payload["id"] = _truncate(gap_id.strip(), ID_MAX)
    elif match and match.strip():
        payload["match"] = _truncate(match.strip(), MATCH_MAX)
    else:
        return {"error": "no selector — pass id or match"}

    try:
        response = await mesh_invoke("intents.close", payload)
    except MeshUnavailable as e:
        # The close couldn't be persisted; raven still answers naturally. Return
        # a tiny error signal rather than deriving a phantom success.
        return {"error": "mesh unavailable", "detail": str(e)}

    # intents.close returns { ok: true, count, closed: [{id, text}] }.
    return {
        "ok": bool(response.get("ok", False)),
        "count": int(response.get("count", 0) or 0),
        "closed": response.get("closed") or [],
    }


def get_tools() -> list[types.Tool]:
    """Return Gemini function declaration for close_gap."""
    func = types.FunctionDeclaration(
        name="close_gap",
        description=(
            "Mark a recorded capability GAP closed because the capability now "
            "exists — call it when the user tells you something you previously "
            "couldn't do is now done or handled ('the email one is done', 'you "
            "can read mail now, mark that closed', 'we built timers, close that "
            "gap'). It moves the matching gap(s) from open to closed in the "
            "ledger and returns a small { ok, count } — confirm briefly ('Marked "
            "closed, sir.', 'Closed two, sir.'). On count 0 nothing matched — say "
            "so plainly ('Nothing matched, sir.'). Pass `match`: a short "
            "substring of what the gap was about (e.g. 'mail', 'timer') — this "
            "closes every open gap whose text contains it, so one call can close "
            "several related gaps. This is the OPPOSITE of report_gap (which "
            "records a new gap); do NOT call it to record a gap, only to retire "
            "an existing one the user says is handled."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "match": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "A short, distinctive substring of the gap's text "
                        "(case-insensitive). Closes EVERY open gap containing "
                        "it. E.g. 'mail' to close mail-related gaps, 'timer' for "
                        "a timer gap. Prefer this — you know the topic, not the "
                        "gap's id."
                    ),
                ),
                "id": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "The exact gap id, if you happen to have it. Usually "
                        "prefer `match`. If both are given, id wins."
                    ),
                ),
            },
            required=[],
        ),
    )
    return [types.Tool(function_declarations=[func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "close_gap":
        return await _close_gap(
            gap_id=args.get("id"),
            match=args.get("match"),
        )
    return None
