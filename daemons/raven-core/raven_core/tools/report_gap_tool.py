"""Report Gap Tool - File something Aether could not do as a gap issue.

The gap rail's voice-side half. When raven hits a request it cannot
fulfil — no tool, no surface, no data behind it — it calls ``report_gap``
with a one-line description. Gaps are filed as GitHub issues on the gap
board (#255: one rail for all work — notice → issue → spec → lane → PR →
merge), and filing is VOICE-GATED: the first call stages nothing and
returns ``{ pending, ask }`` so raven can decline-and-offer in one breath
("I can't do that yet — want me to file it?"); only a second call with
``confirmed: true`` files. Two knobs shape the gate:

  • ``gaps.auto_file`` (config.json, default false) — skip the
    confirmation turn and file on the first call.
  • ``SESSION_CREATE_SOFT_LIMIT`` — after this many creates in one
    session, auto-file is suspended and EVERY further create needs the
    spoken confirmation again (#255 ruling: the dial stays human past
    the limit, whatever the knob says).

The filed record is a RECORD, not a contract (#255 item 3): the gap
text, the verbatim triggering utterance, the session id, and a
timestamp. No spec content — a gap issue earns an ARCHITECT SPEC
comment before any implementer may start from it.

Like notify this is a SIDE-EFFECT tool: the success return is a tiny
ack signal, NOT content to read aloud. The decline stays brief and
conversational; the filing is acknowledged with one short line.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from google.genai import types

from ..config import get_active_config
from ..mesh_client import MeshUnavailable, mesh_invoke
from ..session_context import get_session_context

FUNCTIONS = ["report_gap"]

# Mirrors the filing surface's bounds. raven's descriptions are short
# one-liners; truncating here is cleaner than a noisy MeshDeny from the
# node-side schema validator.
TEXT_MAX = 2000
CONTEXT_MAX = 4000

# Rate guard (#255 item 5, ruling confirmed on #258): after this many
# successful creates in one session, auto-file is suspended and every
# further create requires the spoken confirmation turn regardless of
# gaps.auto_file. Explicit confirmation always remains allowed.
SESSION_CREATE_SOFT_LIMIT = 5

# The exact offer raven speaks when a filing awaits confirmation. Kept
# as a constant so the tool return, the prompt examples, and the spec
# stay one literal string.
CONFIRM_PROMPT = "I can't do that yet — want me to file it?"


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


async def _report_gap(text: str, context: str | None, confirmed: bool) -> dict[str, Any]:
    text = _truncate((text or "").strip(), TEXT_MAX)
    if not text:
        return {"error": "empty gap description"}

    ctx = get_session_context()
    config = get_active_config()
    auto_file = bool(config.gaps_auto_file) if config else False
    under_limit = ctx.gap_creates < SESSION_CREATE_SOFT_LIMIT

    # The voice gate. An unconfirmed call files only when auto_file is
    # on AND the session is under the soft limit; otherwise it returns
    # the pending signal so raven asks the user. Nothing is persisted
    # on the pending path — a declined offer leaves no trace.
    if not confirmed and not (auto_file and under_limit):
        pending: dict[str, Any] = {"pending": True, "ask": CONFIRM_PROMPT}
        if auto_file and not under_limit:
            # Auto-file was on but the guard tripped — surfaced for
            # logs/debugging; raven's behaviour is the same either way.
            pending["reason"] = "rate_guard"
        return pending

    # The full gap record (#255 item 3): the verbatim triggering
    # utterance, session id, and timestamp ride along so the filed
    # issue is a self-contained record of the moment.
    record: dict[str, Any] = {
        "text": text,
        "context": _truncate(context.strip(), CONTEXT_MAX) if context else None,
        "utterance": ctx.utterances[-1] if ctx.utterances else None,
        "session_id": ctx.session_id,
        "ts": datetime.now(timezone.utc).isoformat(),
    }

    result = await _file_gap(record)
    if result.get("ok"):
        ctx.note_gap_create()
    return result


async def _file_gap(record: dict[str, Any]) -> dict[str, Any]:
    # HELD REPOINT (#258, gated on Lane A / #256): this seam moves to
    # github.create_issue once the github node's surface contract (its
    # README) is committed on feat/github-node — the full record
    # (utterance, session_id, ts) rides along then, and the node's
    # built-in dedup returns { deduped, number } on a match. Until that
    # lane merges, intents.record stays the filing backend, and only
    # the fields its schema admits ({ text, context }) are sent.
    payload: dict[str, Any] = {"text": record["text"]}
    if record.get("context"):
        payload["context"] = record["context"]

    try:
        response = await mesh_invoke("intents.record", payload)
    except MeshUnavailable as e:
        # The gap couldn't be persisted, but the conversation must not
        # derail. Return a tiny error signal; raven does not narrate it.
        return {"error": "mesh unavailable", "detail": str(e)}

    # intents.record returns { ok: true, id } on success.
    return {"ok": bool(response.get("ok", False)), "id": response.get("id")}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declaration for report_gap."""
    func = types.FunctionDeclaration(
        name="report_gap",
        description=(
            "File a GAP — something the user asked for that you cannot do "
            "because no tool, surface, or data covers it — as an issue on "
            "the gap board. TWO-TURN flow: call it WITHOUT `confirmed` "
            "first. If it returns { pending: true, ask }, speak the ask "
            "('I can't do that yet — want me to file it?') woven into your "
            "natural decline, then STOP. If the user agrees, call it AGAIN "
            "with the SAME text plus confirmed: true — that files the issue "
            "and returns a tiny success signal, NOT content to read aloud; "
            "acknowledge briefly ('Filed, sir.'). If the user declines, do "
            "not call again — just carry on. If the first call returns "
            "{ ok: true } directly, auto-file is on and the gap is already "
            "filed: decline naturally and briefly without mentioning the "
            "filing. Do NOT call it when a tool exists and simply returned "
            "empty or an error — that is not a capability gap."
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
                        "surface'. Pass the SAME text on the confirmed call."
                    ),
                ),
                "context": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Optional extra detail (the user's phrasing, why no "
                        "tool fit). Omit if the one-liner says enough."
                    ),
                ),
                "confirmed": types.Schema(
                    type=types.Type.BOOLEAN,
                    description=(
                        "Pass true ONLY after the user has just agreed to "
                        "file this gap. Never true on the first call."
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
            confirmed=bool(args.get("confirmed", False)),
        )
    return None
