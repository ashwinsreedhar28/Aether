"""Close Lane Tool - Tear a finished lane down by voice, the spawn's mirror.

Lane closeout (#317). Spawning a lane is one utterance + one card; closing
one used to be manual archaeology — two-beat card COMPLETE, copy the cleanup
block, run it in a terminal. ``close_lane`` appends a ``kind: "teardown"``
request to the same spawn ledger the shell's SpawnService watches; the shell
runs the guards (an open PR on the lane's branch refuses; a busy pane
refuses; a dirty worktree or unpushed branch draws the warn card whose CLOSE
ANYWAY is the only force path) and, when clean, executes the canonical
cleanup block itself — tmux kill-session, worktree removed, branch deleted,
record closed, capacity freed. The done/failed outcome lands on the lane's
card.

Confirm-gated BY VOICE: the first call returns ``{ pending, ask }`` so raven
asks out loud; only a second call with ``confirmed: true`` appends the
request. Destroying a worktree is a real side effect — never silent (same
posture as lane_proceed's keystroke gate).

This tool never writes the force flag: the dirty-tree override is the card's
CLOSE ANYWAY button only (the #308 warn-and-force law). There is no voice
path past the warn, and pr-open / lane-busy refusals have no force path at
all.

Like lane_proceed this is a SIDE-EFFECT tool: the ledger append is the only
artifact, the return is a tiny signal ({ ok: true } means RECORDED — the
done/failed outcome lands on the card), and raven speaks ONE line.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from google.genai import types

FUNCTIONS = ["close_lane", "close_out_lane"]

# Same ledger work_on_issue / lane_proceed append to and the shell folds.
SPAWNS_SUBPATH = ("spawns",)
LEDGER_NAME = "requests.jsonl"

# Lane states a closeout may target: live, or a prior teardown's failure
# (the retry path — the shell's executor resumes from the failed step).
_CLOSEABLE = ("spawned", "teardown_failed")


def _data_root() -> Path:
    """Resolve the shared data root — identical to lane_proceed_tool."""
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
    """Fold the ledger for the newest CLOSEABLE lane record bound to `issue`
    (falling back to the newest record when none is closeable) and return its
    current status, or None when no lane record names that issue. Relay
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
    # The teardown executor's resolution rule, mirrored (spawnService's
    # 'spawned' | 'teardown_failed' pick — status FIRST, newest among the
    # matches): the newest CLOSEABLE record wins, so a dead newer duplicate
    # never hides the live lane beside it (#383, the July-14 374 shape).
    # With no closeable record, the newest record's status shapes the
    # spoken refusal.
    for rec_id in reversed(lane_ids):
        status = status_by_id.get(rec_id)
        if status in _CLOSEABLE:
            return status
    return status_by_id.get(lane_ids[-1])


def _append_teardown(issue: int) -> None:
    """Append one teardown request line, fsync'd — the shape the shell's
    foldTeardowns expects: every teardown line carries kind: "teardown".
    Deliberately NO force field — force is card-only (CLOSE ANYWAY)."""
    ledger = _ledger_path()
    ledger.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "id": os.urandom(8).hex(),
        "ts": datetime.now(timezone.utc).isoformat(),
        "kind": "teardown",
        "issue": issue,
        "status": "requested",
    }
    payload = (json.dumps(record) + "\n").encode("utf-8")
    fd = os.open(str(ledger), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        os.write(fd, payload)
        os.fsync(fd)
    finally:
        os.close(fd)


def _close_lane(number: Any, confirmed: bool) -> dict[str, Any]:
    n = _normalize_number(number)
    if n is None:
        return {"ok": False, "error": "no usable lane number"}

    status = _lane_status(n)
    if status is None:
        return {"ok": False, "error": f"no lane record for issue #{n}"}
    if status == "closed":
        return {"ok": False, "error": f"lane #{n} is already closed"}
    if status == "requested":
        # Out of scope by spec: dismiss covers requested-state records.
        return {
            "ok": False,
            "error": f"lane #{n} is still awaiting approval — dismiss its card instead",
        }
    if status not in _CLOSEABLE:
        return {"ok": False, "error": f"lane #{n} is {status}, not closeable"}

    if not confirmed:
        return {
            "pending": True,
            "issue": n,
            "ask": (
                f"Close out lane #{n}? Its session, worktree, and branch "
                "will be deleted."
            ),
        }

    try:
        _append_teardown(n)
    except OSError as e:
        return {"ok": False, "error": "could not record teardown", "detail": str(e)}

    print(f"[CLOSE_LANE] teardown recorded for lane #{n}")
    return {"ok": True, "issue": n}


_DESCRIPTION = (
    "CLOSE OUT a finished lane — guarded teardown of its tmux session, "
    "worktree, and branch: 'close out lane 310' / 'tear down lane 310' / "
    "'lane 310 is done, close it out'. Use when a lane's PR has merged (or "
    "the lane is abandoned) and the user wants its workspace gone and its "
    "capacity slot freed. ALWAYS confirm-gated: the first call returns "
    "{ pending, ask } — speak the ask and STOP; only if the user explicitly "
    "confirms, call again with the SAME number plus confirmed: true. A "
    "SIDE-EFFECT tool: it RECORDS the teardown request and returns a tiny "
    "signal ({ ok: true } = recorded; the shell runs the guards and the "
    "cleanup, and the card shows the done/failed outcome) — say one line "
    "('Closing it out, sir.'). The shell REFUSES when a PR is still open on "
    "the lane's branch or its pane is mid-session, and WARNS on the card "
    "(explicit CLOSE ANYWAY required there) when the worktree has "
    "uncommitted or unpushed work — relay such outcomes briefly if asked. "
    "{ ok: false, error } names the problem (no lane record, already closed, "
    "still awaiting approval) — relay briefly. Distinct from work_on_issue / "
    "spawn_lane (ARMS a lane), lane_proceed (relays the go-ahead), and "
    "show_lane_card (RAISES a card). NOT for dismissing un-approved "
    "requests — the card's dismiss covers those."
)

_PARAMETERS = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "number": types.Schema(
            type=types.Type.INTEGER,
            description="The lane's issue number ('close out lane 310' → 310).",
        ),
        "confirmed": types.Schema(
            type=types.Type.BOOLEAN,
            description=(
                "Pass true ONLY after the user has just agreed, by voice, to "
                "tear the lane down. Never on the first call."
            ),
        ),
    },
    required=["number"],
)


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations: close_lane + its spoken alias."""
    close_lane = types.FunctionDeclaration(
        name="close_lane",
        description=_DESCRIPTION,
        parameters=_PARAMETERS,
    )
    close_out_lane = types.FunctionDeclaration(
        name="close_out_lane",
        description=(
            "Alias of close_lane — identical arguments and behaviour. Use "
            "when the user phrases it as 'close out lane N'."
        ),
        parameters=_PARAMETERS,
    )
    return [types.Tool(function_declarations=[close_lane, close_out_lane])]


def handle_call(name: str, args: dict) -> dict[str, Any] | None:
    """Sync tool handler — pure ledger file I/O, no mesh hop."""
    if name in FUNCTIONS:
        return _close_lane(
            number=args.get("number"),
            confirmed=bool(args.get("confirmed", False)),
        )
    return None
