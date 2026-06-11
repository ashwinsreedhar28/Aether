"""Report Gap Tool - File something Aether could not do as a gap issue.

The gap rail's voice-side half. When raven hits a request it cannot
fulfil — no tool, no surface, no data behind it — it calls ``report_gap``
with the capability area and a one-line summary. Gaps are filed as
GitHub issues on the gap board via ``github.create_issue`` (#255: one
rail for all work — notice → issue → spec → lane → PR → merge; the edge
``raven → github.create_issue`` in manifest.yaml authorises the hop),
and filing is VOICE-GATED: the first call stages nothing and returns
``{ pending, ask }`` so raven can decline-and-offer in one breath
("I can't do that yet — want me to file it?"); only a second call with
``confirmed: true`` files. Two knobs shape the gate:

  • ``gaps.auto_file`` (config.json, default false) — skip the
    confirmation turn and file on the first call.
  • ``SESSION_CREATE_SOFT_LIMIT`` — after this many creates in one
    session, auto-file is suspended and EVERY further create needs the
    spoken confirmation again (#255 ruling: the dial stays human past
    the limit, whatever the knob says).

Dedup lives INSIDE the node (#255 ruling 1): a repeat ask lands as a
"+1" comment on the existing open issue and the surface returns
``{ deduped: true, number }`` — raven acknowledges the repeat instead
of claiming a fresh filing.

The filed record is a RECORD, not a contract (#255 item 3): area,
summary, the verbatim triggering utterance (from session context),
failure detail, and the session id. No spec content — a gap issue earns
an ARCHITECT SPEC comment before any implementer may start from it.

Like notify this is a SIDE-EFFECT tool: the success return is a tiny
ack signal, NOT content to read aloud. The decline stays brief and
conversational; the filing is acknowledged with one short line.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..config import get_active_config
from ..mesh_client import MeshUnavailable, mesh_invoke
from ..session_context import get_session_context

FUNCTIONS = ["report_gap"]

# Mirrors nodes/github/src/gap.ts bounds (the surface contract,
# nodes/github/README.md). Truncating here is cleaner than a noisy
# MeshDeny from the node-side schema validator.
AREA_MAX = 60
SUMMARY_MAX = 180
UTTERANCE_MAX = 2000
FAILURE_MAX = 2000
CAPABILITY_KEY_MAX = 120

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


async def _report_gap(
    area: str,
    summary: str,
    failure: str | None,
    capability_key: str | None,
    confirmed: bool,
) -> dict[str, Any]:
    area = _truncate((area or "").strip(), AREA_MAX)
    summary = _truncate((summary or "").strip(), SUMMARY_MAX)
    if not area or not summary:
        return {"error": "missing area or summary"}

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

    # The full gap record (#255 item 3). The verbatim triggering
    # utterance comes from session context — `utterance` is required by
    # the surface, so when no transcription was captured (e.g. a typed
    # session) the summary stands in. The node stamps filed-at and
    # derives the dedup key from area+summary when none is passed.
    utterance = ctx.utterances[-1] if ctx.utterances else summary
    payload: dict[str, Any] = {
        "area": area,
        "summary": summary,
        "utterance": _truncate(utterance, UTTERANCE_MAX),
        "session_id": ctx.session_id,
    }
    if failure and failure.strip():
        payload["failure"] = _truncate(failure.strip(), FAILURE_MAX)
    if capability_key and capability_key.strip():
        payload["capability_key"] = _truncate(capability_key.strip(), CAPABILITY_KEY_MAX)

    result = await _file_gap(payload)
    if result.get("ok"):
        ctx.note_gap_create()
    return result


async def _file_gap(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        response = await mesh_invoke("github.create_issue", payload)
    except MeshUnavailable as e:
        # MeshDeny surfaces here too, with the deny string as `reason`.
        # github_no_token is the contract's degraded mode — name it so
        # raven can say filing isn't configured rather than "mesh down".
        # Either way the conversation must not derail; raven does not
        # narrate the detail.
        if getattr(e, "reason", None) == "github_no_token":
            return {"error": "github token not configured — filing unavailable"}
        return {"error": "mesh unavailable", "detail": str(e)}

    # github.create_issue returns { ok, deduped, number, url, ... } —
    # deduped: true means a repeat ask landed as a +1 comment on the
    # existing open issue (raven acknowledges the repeat, not a fresh
    # filing).
    return {
        "ok": bool(response.get("ok", False)),
        "deduped": bool(response.get("deduped", False)),
        "number": response.get("number"),
    }


def get_tools() -> list[types.Tool]:
    """Return Gemini function declaration for report_gap."""
    func = types.FunctionDeclaration(
        name="report_gap",
        description=(
            "File a GAP — something the user asked for that you cannot do "
            "because no tool, surface, or data covers it — as an issue on "
            "the gap board (titled 'gap(<area>): <summary>'). TWO-TURN "
            "flow: call it WITHOUT `confirmed` first. If it returns "
            "{ pending: true, ask }, speak the ask ('I can't do that yet — "
            "want me to file it?') woven into your natural decline, then "
            "STOP. If the user agrees, call it AGAIN with the SAME area and "
            "summary plus confirmed: true — that files the issue and "
            "returns a tiny success signal, NOT content to read aloud; "
            "acknowledge briefly ('Filed, sir.'). If it returns "
            "{ deduped: true }, the gap was already on the board and your "
            "ask landed as a +1 — say so ('Already on the board, sir — "
            "noted the repeat.'). If the user declines, do not call again — "
            "just carry on. If the first call returns { ok: true } "
            "directly, auto-file is on and the gap is already filed: "
            "decline naturally and briefly. Do NOT call it when a tool "
            "exists and simply returned empty or an error — that is not a "
            "capability gap."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "area": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "The capability area, one short lowercase word or "
                        "hyphenated pair for the issue title: 'email', "
                        "'timers', 'smart-home', 'music'."
                    ),
                ),
                "summary": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "One-line summary of the missing capability, in the "
                        "form '<what the user asked for>; <what was missing>'. "
                        "E.g. 'user asked to set a timer; no timer surface'. "
                        "Pass the SAME summary on the confirmed call."
                    ),
                ),
                "failure": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Optional: the tool path you attempted or why no "
                        "tool fit. Omit if the summary says enough."
                    ),
                ),
                "capability_key": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Optional stable dedup key when you can name the "
                        "capability more stably than the summary wording "
                        "(e.g. 'smart-home-lights'). Usually omit — the "
                        "board derives one from area + summary."
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
            required=["area", "summary"],
        ),
    )
    return [types.Tool(function_declarations=[func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "report_gap":
        return await _report_gap(
            area=args.get("area", ""),
            summary=args.get("summary", ""),
            failure=args.get("failure"),
            capability_key=args.get("capability_key"),
            confirmed=bool(args.get("confirmed", False)),
        )
    return None
