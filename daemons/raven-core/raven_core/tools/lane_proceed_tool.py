"""Lane Proceed Tool - Relay the "clean, proceed" go-ahead to a lane by voice.

Rung 2.5 of the Architect arc (#310). A spawned lane posts its gate report to
its issue thread and stops at the gate; the go-ahead used to be pane
archaeology — tmux attach, type, detach. ``lane_proceed`` appends a
``kind: "relay"`` request to the same spawn ledger the shell's SpawnService
watches; the shell validates the lane is live, types the FIXED text into the
lane's pane via the pane-id send machinery, and writes the relayed/failed
outcome back to the ledger (the lane's card shows it).

Confirm-gated BY VOICE: the first call returns ``{ pending, ask }`` so raven
asks out loud; only a second call with ``confirmed: true`` appends the
request. Keystrokes into a live implementer session are a real side effect —
never silent (same posture as work_on_issue's spec override).

v1 allowlist (#310 spec): the relay text is the LITERAL "clean, proceed" and
nothing else. This tool takes no text argument, and the shell enforces the
same allowlist before touching the pane — arbitrary relay text has no code
path. Auto-proceed of any kind is equally out of scope: this tool only ever
fires from a human utterance, behind a spoken confirm.

Like work_on_issue this is a SIDE-EFFECT tool: the ledger append is the only
artifact, the return is a tiny signal ({ ok: true } means RECORDED — the
relayed/failed outcome lands on the card), and raven speaks ONE line.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from google.genai import types

FUNCTIONS = ["lane_proceed", "proceed_lane"]

# Same ledger work_on_issue appends to and the shell's SpawnService folds.
SPAWNS_SUBPATH = ("spawns",)
LEDGER_NAME = "requests.jsonl"

# THE V1 RELAY ALLOWLIST — kept in sync with the shell's spawnLedger.ts
# RELAY_TEXT. The shell refuses any recorded text that is not this literal.
RELAY_TEXT = "clean, proceed"


def _data_root() -> Path:
    """Resolve the shared data root — identical to work_on_issue_tool."""
    base = os.environ.get("AETHER_DATA_DIR") or os.environ.get("RAVEN_USER_DIR")
    return Path(base) if base else Path.home() / ".raven"


def _ledger_path() -> Path:
    return _data_root().joinpath(*SPAWNS_SUBPATH, LEDGER_NAME)


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


def _lane_status(issue: int) -> str | None:
    """Fold the ledger for the NEWEST lane record bound to `issue` and return
    its current status, or None when no lane record names that issue. Relay
    (#310) and teardown (#317) lines are skipped wholesale by their kind tag —
    they share the log but never describe a lane. The shell re-validates
    against live state at execution time; this fold only shapes the spoken
    answer."""
    ledger = _ledger_path()
    if not ledger.is_file():
        return None
    try:
        raw = ledger.read_text(encoding="utf-8")
    except OSError:
        return None
    lane_ids: list[str] = []  # lane request ids for `issue`, append order
    status_by_id: dict[str, str] = {}
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if obj.get("kind") in ("relay", "teardown"):
            continue
        rec_id = obj.get("id")
        if not isinstance(rec_id, str):
            continue
        if obj.get("kind") == "lane" and obj.get("issue") == issue and rec_id not in lane_ids:
            lane_ids.append(rec_id)
        status = obj.get("status")
        if isinstance(status, str):
            status_by_id[rec_id] = status
    if not lane_ids:
        return None
    # Newest arm wins: an old dismissed request for the same issue must not
    # shadow the live lane that replaced it.
    return status_by_id.get(lane_ids[-1])


def _append_relay(issue: int) -> None:
    """Append one relay request line, fsync'd — the shape the shell's
    foldRelays expects: every relay line carries kind: "relay"."""
    ledger = _ledger_path()
    ledger.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "id": os.urandom(8).hex(),
        "ts": datetime.now(timezone.utc).isoformat(),
        "kind": "relay",
        "issue": issue,
        "text": RELAY_TEXT,
        "status": "requested",
    }
    payload = (json.dumps(record) + "\n").encode("utf-8")
    fd = os.open(str(ledger), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        os.write(fd, payload)
        os.fsync(fd)
    finally:
        os.close(fd)


def _lane_proceed(number: Any, confirmed: bool) -> dict[str, Any]:
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
                f"Relay 'clean, proceed' to lane #{n}? It will open its PR."
            ),
        }

    try:
        _append_relay(n)
    except OSError as e:
        return {"ok": False, "error": "could not record relay", "detail": str(e)}

    print(f"[LANE_PROCEED] relay recorded for lane #{n}")
    return {"ok": True, "issue": n}


_DESCRIPTION = (
    "RELAY the literal go-ahead 'clean, proceed' into a LIVE lane's Claude "
    "Code session: 'proceed lane 310' / 'lane 310 is clean, proceed' / 'tell "
    "lane 310 to ship'. Use when a lane sits AT ITS GATE (its gate report is "
    "on the card / issue thread) and the user wants it to open its PR. ALWAYS "
    "confirm-gated: the first call returns { pending, ask } — speak the ask "
    "and STOP; only if the user explicitly confirms, call again with the SAME "
    "number plus confirmed: true. A SIDE-EFFECT tool: it RECORDS the relay "
    "request and returns a tiny signal ({ ok: true } = recorded; the shell "
    "types the line into the lane's pane and the card shows the "
    "relayed/failed outcome) — say one line ('Relayed, sir.'). { ok: false, "
    "error } names the problem (no lane record, lane not live) — relay "
    "briefly. The text is FIXED: there is no way to send anything except the "
    "literal 'clean, proceed' (arbitrary relay text is out of scope). "
    "Distinct from work_on_issue / spawn_lane (ARMS a new lane) and "
    "show_lane_card (RAISES a lane's card)."
)

_PARAMETERS = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "number": types.Schema(
            type=types.Type.INTEGER,
            description="The lane's issue number ('proceed lane 310' → 310).",
        ),
        "confirmed": types.Schema(
            type=types.Type.BOOLEAN,
            description=(
                "Pass true ONLY after the user has just agreed, by voice, to "
                "relay the go-ahead. Never on the first call."
            ),
        ),
    },
    required=["number"],
)


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations: lane_proceed + its spoken alias."""
    lane_proceed = types.FunctionDeclaration(
        name="lane_proceed",
        description=_DESCRIPTION,
        parameters=_PARAMETERS,
    )
    proceed_lane = types.FunctionDeclaration(
        name="proceed_lane",
        description=(
            "Alias of lane_proceed — identical arguments and behaviour. Use "
            "when the user phrases it as 'proceed lane N'."
        ),
        parameters=_PARAMETERS,
    )
    return [types.Tool(function_declarations=[lane_proceed, proceed_lane])]


def handle_call(name: str, args: dict) -> dict[str, Any] | None:
    """Sync tool handler — pure ledger file I/O, no mesh hop."""
    if name in FUNCTIONS:
        return _lane_proceed(
            number=args.get("number"),
            confirmed=bool(args.get("confirmed", False)),
        )
    return None
