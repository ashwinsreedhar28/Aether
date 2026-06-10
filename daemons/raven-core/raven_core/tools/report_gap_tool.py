"""Report Gap Tool - Record something Aether could not do.

The gap sensor's voice-side half. When raven hits a request it cannot
fulfil — no tool, no surface, no data behind it — it calls ``report_gap``
with a one-line description. The implementation invokes ``intents.record``
through ``mesh_client.mesh_invoke`` rather than persisting anything itself;
the edge ``raven → intents.record`` in manifest.yaml authorises the hop.

Like notify this is a SIDE-EFFECT tool: the return is a tiny
ack signal (the new gap's id), NOT content to read aloud. raven records
the gap and, in the same breath, declines naturally to the user — the
decline stays brief and conversational; the recording is invisible to it.

First brick of the self-building arc: Aether noticing what it can't do so
the gap can later become a capability.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["report_gap"]

# Mirrors nodes/intents/schemas/record.json bounds. raven's descriptions are
# short one-liners; truncating here is cleaner than a noisy MeshDeny from the
# intents-side schema validator.
TEXT_MAX = 2000
CONTEXT_MAX = 4000


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


async def _report_gap(text: str, context: str | None) -> dict[str, Any]:
    text = _truncate((text or "").strip(), TEXT_MAX)
    if not text:
        return {"error": "empty gap description"}

    payload: dict[str, Any] = {"text": text}
    if context:
        payload["context"] = _truncate(context.strip(), CONTEXT_MAX)

    try:
        response = await mesh_invoke("intents.record", payload)
    except MeshUnavailable as e:
        # The gap couldn't be persisted, but the user still gets their natural
        # decline — the tool failing must not derail the conversation. Return a
        # tiny error signal; raven does not narrate it.
        return {"error": "mesh unavailable", "detail": str(e)}

    # intents.record returns { ok: true, id } on success.
    return {"ok": bool(response.get("ok", False)), "id": response.get("id")}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declaration for report_gap."""
    func = types.FunctionDeclaration(
        name="report_gap",
        description=(
            "Record a GAP — something the user asked for that you cannot do "
            "because no tool, surface, or data covers it. This is a "
            "SIDE-EFFECT tool: it logs the gap for later and returns only a "
            "tiny success signal — it does NOT return content to read aloud. "
            "Call it whenever you are about to tell the user you can't do "
            "something, passing a one-line description of what was missing "
            "(e.g. 'user asked to read email; no mail-reading surface'). Then "
            "decline to the user naturally and briefly. Do NOT call it when a "
            "tool exists and simply returned empty or an error — that is not a "
            "capability gap."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "text": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "One-line description of the missing capability, in "
                        "the form '<what the user asked for>; <what was "
                        "missing>'. E.g. 'user asked to set a timer; no timer "
                        "surface'."
                    ),
                ),
                "context": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Optional extra detail (the user's phrasing, why no "
                        "tool fit). Omit if the one-liner says enough."
                    ),
                ),
            },
            required=["text"],
        ),
    )
    return [types.Tool(function_declarations=[func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "report_gap":
        return await _report_gap(
            text=args.get("text", ""),
            context=args.get("context"),
        )
    return None
