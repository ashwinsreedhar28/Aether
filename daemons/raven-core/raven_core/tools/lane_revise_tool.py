"""Lane Revise Tool - Relay the fixed revise order to a gated lane by voice.

R2, the revision loop (#339). A lane at its gate that draws Director feedback
gets sent back with ONE fixed sentence: ``lane_revise`` appends a
``kind: "relay"`` request carrying REVISE_TEXT to the same spawn ledger the
shell's SpawnService watches; the shell validates the lane is live, types the
FIXED text into the lane's pane, and writes the relayed/failed outcome back
to the ledger (the lane's card shows it). The lane then reads the LATEST
DIRECTOR FEEDBACK comment on its issue, addresses it, and re-gates (the
kickoff dictates the loop).

TRIGGER-ONLY in v1: this tool relays the order, never the feedback CONTENT —
freeform feedback travels the issue thread (posted from the lane card's
REVISE path), and the pane receives nothing but allowlisted sentences (#339
law iii). Voice-dictated feedback content is the designated fast-follow,
filling spawn.revise(feedbackText) shell-side; no new machinery here.

Confirm-gated BY VOICE, exactly the lane_proceed pattern: the first call
returns ``{ pending, ask }`` so raven asks out loud; only a second call with
``confirmed: true`` appends the request. Keystrokes into a live implementer
session are a real side effect — never silent.

Like lane_proceed this is a SIDE-EFFECT tool: the ledger append is the only
artifact, the return is a tiny signal ({ ok: true } means RECORDED — the
relayed/failed outcome lands on the card), and raven speaks ONE line.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from google.genai import types

# The confirm gate, ledger location, and live-lane fold are byte-identical to
# lane_proceed's — imported, not re-duplicated (this is the fourth tool over
# the spawns ledger; the third instance already paid the copy tax).
from .lane_proceed_tool import _ledger_path, _lane_status, _normalize_number

FUNCTIONS = ["lane_revise", "revise_lane"]

# THE REVISE ALLOWLIST LITERAL — kept in sync with the shell's spawnLedger.ts
# REVISE_TEXT. The shell refuses any recorded text off its two-sentence
# allowlist, so a drift here is a relay that never reaches a pane.
REVISE_TEXT = "revise per the latest DIRECTOR FEEDBACK, then re-gate"


def _append_relay(issue: int) -> None:
    """Append one relay request line carrying REVISE_TEXT, fsync'd — the
    shape the shell's foldRelays expects: every relay line carries
    kind: "relay"."""
    ledger = _ledger_path()
    ledger.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "id": os.urandom(8).hex(),
        "ts": datetime.now(timezone.utc).isoformat(),
        "kind": "relay",
        "issue": issue,
        "text": REVISE_TEXT,
        "status": "requested",
    }
    payload = (json.dumps(record) + "\n").encode("utf-8")
    fd = os.open(str(ledger), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        os.write(fd, payload)
        os.fsync(fd)
    finally:
        os.close(fd)


def _lane_revise(number: Any, confirmed: bool) -> dict[str, Any]:
    n = _normalize_number(number)
    if n is None:
        return {"ok": False, "error": "no usable lane number"}

    status = _lane_status(n)
    if status is None:
        return {"ok": False, "error": f"no lane record for issue #{n}"}
    if status != "spawned":
        return {"ok": False, "error": f"lane #{n} is {status}, not live"}

    if not confirmed:
        return {
            "pending": True,
            "issue": n,
            "ask": (
                f"Send lane #{n} back to revise per the latest DIRECTOR "
                f"FEEDBACK? It will re-gate when done."
            ),
        }

    try:
        _append_relay(n)
    except OSError as e:
        return {"ok": False, "error": "could not record relay", "detail": str(e)}

    print(f"[LANE_REVISE] revise relay recorded for lane #{n}")
    return {"ok": True, "issue": n}


_DESCRIPTION = (
    "RELAY the fixed revise order 'revise per the latest DIRECTOR FEEDBACK, "
    "then re-gate' into a LIVE lane's Claude Code session: 'revise lane 339' "
    "/ 'send lane 339 back' / 'lane 339 needs another pass'. Use when a lane "
    "sits at its gate (or is already REVISING) and the user wants it to "
    "address the newest DIRECTOR FEEDBACK comment on its issue thread. "
    "TRIGGER ONLY: it never carries feedback content — the feedback itself is "
    "posted on the lane card / issue thread, and there is no way to send "
    "anything except the fixed sentence. ALWAYS confirm-gated: the first call "
    "returns { pending, ask } — speak the ask and STOP; only if the user "
    "explicitly confirms, call again with the SAME number plus confirmed: "
    "true. A SIDE-EFFECT tool: it RECORDS the relay request and returns a "
    "tiny signal ({ ok: true } = recorded; the shell types the line into the "
    "lane's pane and the card shows the relayed/failed outcome) — say one "
    "line ('Sent back, sir.'). { ok: false, error } names the problem (no "
    "lane record, lane not live) — relay briefly. Distinct from lane_proceed "
    "(relays the GO-AHEAD; the lane ships) and show_lane_card (RAISES a "
    "lane's card)."
)

_PARAMETERS = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "number": types.Schema(
            type=types.Type.INTEGER,
            description="The lane's issue number ('revise lane 339' → 339).",
        ),
        "confirmed": types.Schema(
            type=types.Type.BOOLEAN,
            description=(
                "Pass true ONLY after the user has just agreed, by voice, to "
                "send the lane back. Never on the first call."
            ),
        ),
    },
    required=["number"],
)


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations: lane_revise + its spoken alias."""
    lane_revise = types.FunctionDeclaration(
        name="lane_revise",
        description=_DESCRIPTION,
        parameters=_PARAMETERS,
    )
    revise_lane = types.FunctionDeclaration(
        name="revise_lane",
        description=(
            "Alias of lane_revise — identical arguments and behaviour. Use "
            "when the user phrases it as 'revise lane N'."
        ),
        parameters=_PARAMETERS,
    )
    return [types.Tool(function_declarations=[lane_revise, revise_lane])]


def handle_call(name: str, args: dict) -> dict[str, Any] | None:
    """Sync tool handler — pure ledger file I/O, no mesh hop."""
    if name in FUNCTIONS:
        return _lane_revise(
            number=args.get("number"),
            confirmed=bool(args.get("confirmed", False)),
        )
    return None
