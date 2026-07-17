"""Work On Issue Tool - Arm implementer lanes against GitHub issues by voice.

Rung 3 of the Architect arc (#268). ``request_spawn`` (rung 2) hands a
*drafted* lane to a fresh Implementer; ``work_on_issue`` skips the draft and
arms a lane against an ISSUE — "Aether, work on issue 271" — fetching it via
``github.get_issue`` (the edge ``raven → github.get_issue`` in manifest.yaml
authorises the hop), guarding on the ARCHITECT SPEC marker, and appending
``kind: "lane"`` request lines to the same spawn ledger the shell's
SpawnService watches. The shell raises ONE SpawnApproval card per batch; on
approve it runs the worktree + tmux + terminal + tiling choreography.

Gating (#268 ruling, recorded on the issue): work_on_issue is CARD-GATED
ONLY — no spoken passphrase. The utterance names a specific board-vetted
issue (low accidental-trigger surface), the spec guard is a second gate, and
the Director's card tap is the physical human gate. The passphrase stays on
request_spawn's draft path, where free-form content justifies gating twice.
This is a deliberate, scoped loosening — not a precedent for other tools.

Batch semantics (#268 addendum): ``numbers`` arms several issues in ONE call
producing ONE approval card — single approve spawns all, cancel spawns none.
A batch exceeding remaining capacity (``spawn.max_lanes``, default 3) is
refused whole: raven names the cap and asks which to start now — never a
silent truncation, never past the cap.

Spec guard (#268 pre-decision 2): an issue whose body and comments lack the
literal "ARCHITECT SPEC" marker is a record, not a contract (CLAUDE.md §1).
The first call returns ``{ pending, ask }`` so raven says so out loud; only a
second call with ``confirmed: true`` arms it anyway — the Director's override
is BY VOICE, never silent. gap-labeled issues get the same treatment (a gap
WITH a spec comment passes like any other issue).

Already-armed guard (#394): an issue that already holds a requested-or-live
lane record (requested | spawned | teardown_failed — the capacity set) is
refused at the source, pointing at the existing card or lane; batch calls
arm the rest and name the skipped. The fold fix (#397) makes duplicates
harmless; this guard makes them rare. Not overridable by ``confirmed`` —
that flag belongs to the spec guard alone.

Like request_spawn this is a SIDE-EFFECT tool: the ledger append is the only
artifact, the return is a tiny signal, and raven speaks ONE line — it never
reads specs, branches, or worktrees aloud.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from google.genai import types

from ..config import get_active_config
from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["work_on_issue", "spawn_lane"]

# Same ledger request_spawn appends to and the shell's SpawnService folds.
SPAWNS_SUBPATH = ("spawns",)
LEDGER_NAME = "requests.jsonl"

# The record-not-contract marker (CLAUDE.md §1). Line-anchored: the marker
# certifies only when it leads a line — optionally indented and/or fenced
# ("ARCHITECT SPEC — fix…", "=== ARCHITECT SPEC ===") — so a mid-sentence
# mention (the gap footer's prose) never passes the guard. Case-sensitive
# on purpose: the law's literal form is all-caps.
_SPEC_MARKER_RE = re.compile(r"^\s*(?:=+\s*)?ARCHITECT SPEC", re.MULTILINE)

# Hard cap on one utterance's batch size, independent of spawn.max_lanes —
# a mis-heard number list must not fan out into a dozen API reads.
BATCH_MAX = 6

DEFAULT_MAX_LANES = 3


def _data_root() -> Path:
    """Resolve the shared data root — identical to request_spawn_tool."""
    base = os.environ.get("AETHER_DATA_DIR") or os.environ.get("RAVEN_USER_DIR")
    return Path(base) if base else Path.home() / ".raven"


def _ledger_path() -> Path:
    return _data_root().joinpath(*SPAWNS_SUBPATH, LEDGER_NAME)


def _max_lanes() -> int:
    """The spawn.max_lanes knob. Under the shell the env var is authoritative
    (single-sourced from .env.local and shared with the shell's approve gate);
    config.json's { "spawn": { "max_lanes": N } } covers standalone CLI runs."""
    raw = os.environ.get("AETHER_SPAWN_MAX_LANES", "").strip()
    if raw.isdigit() and int(raw) >= 1:
        return int(raw)
    config = get_active_config()
    knob = getattr(config, "spawn_max_lanes", None) if config else None
    if isinstance(knob, int) and knob >= 1:
        return knob
    return DEFAULT_MAX_LANES


def _committed_count() -> int:
    """Fold the spawn ledger and count records holding capacity: live lanes
    ('spawned', not yet closed), failed teardowns ('teardown_failed' — #317:
    capacity is freed only by 'closed'), plus pending approval cards
    ('requested'). Draft-kind spawns count too (#268 ruling — same cap, same
    resource: a Claude Code session). A malformed line is skipped, mirroring
    the shell's fold. The shell's approve gate re-checks against live state —
    this count only shapes the conversational capacity ask."""
    ledger = _ledger_path()
    if not ledger.is_file():
        return 0
    latest: dict[str, str] = {}
    try:
        raw = ledger.read_text(encoding="utf-8")
    except OSError:
        return 0
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if obj.get("kind") in ("relay", "teardown"):
            # Relay (#310) and teardown (#317) lines share the ledger but
            # hold no lane capacity — a pending "clean, proceed" or "close
            # out lane N" must not eat an approve slot. Every such line
            # carries its kind tag.
            continue
        rec_id = obj.get("id")
        status = obj.get("status")
        if isinstance(rec_id, str) and isinstance(status, str):
            latest[rec_id] = status
    return sum(1 for s in latest.values() if s in ("requested", "spawned", "teardown_failed"))


# The arming set (#394): the same statuses that hold capacity in
# _committed_count — a pending card, a live lane, a failed teardown still
# holding its worktree. Priority order for the spoken state: the liveliest
# wins, so a pending duplicate card never masks the live lane beside it.
_ARMED_STATUSES = ("spawned", "teardown_failed", "requested")


def _already_armed(wanted: list[int]) -> dict[int, str]:
    """Fold the ledger for the target issues' arming state: {issue: status}
    for every issue already holding a requested-or-live lane record; an
    issue absent from the map is clear to arm. Per-issue resolution is
    status FIRST (spawned, then teardown_failed, then requested) — the
    #383 law over the arming set, so a dead newer duplicate never masks the
    live lane and dead records never block a fresh arm; only the winning
    STATE is reported, so recency never matters within a status tier.
    Relay (#310) and teardown (#317) lines are skipped wholesale by kind.
    The shell's approve gate re-checks live state; this fold only shapes
    the refusal."""
    ledger = _ledger_path()
    if not ledger.is_file():
        return {}
    try:
        raw = ledger.read_text(encoding="utf-8")
    except OSError:
        return {}
    ids_by_issue: dict[int, list[str]] = {n: [] for n in wanted}
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
        if obj.get("kind") == "lane":
            ids = ids_by_issue.get(obj.get("issue"))
            if ids is not None and rec_id not in ids:
                ids.append(rec_id)
        status = obj.get("status")
        if isinstance(status, str):
            status_by_id[rec_id] = status
    armed: dict[int, str] = {}
    for n, ids in ids_by_issue.items():
        for state in _ARMED_STATUSES:
            if any(status_by_id.get(i) == state for i in ids):
                armed[n] = state
                break
    return armed


# Branch:/Worktree: parsing — regex parity with the shell's
# spawnLedger.parseDraftTargets (THE SLUG CONTRACT's sibling for issues):
# both tokens are the first whitespace-delimited run after the colon.
_BRANCH_RE = re.compile(r"^[ \t]*Branch:[ \t]*(\S+)", re.MULTILINE)
_WORKTREE_RE = re.compile(r"(?:^|\s)Worktree:[ \t]*(\S+)")
# Submodule opt-in (#376): a `Submodules: on` line in the spec opts the lane's
# worktree cut into `git submodule update --init --recursive` (default OFF —
# ordinary lanes never read _ingest/ from the worktree). Regex parity with the
# shell's SUBMODULES_RE (spawnService.ts), same shape as _WORKTREE_RE above.
_SUBMODULES_RE = re.compile(r"(?:^|\s)Submodules:[ \t]*on\b")


def _targets_for_issue(number: int, spec_text: str | None) -> tuple[str, str]:
    """Branch + worktree for a lane: the spec's own Branch:/Worktree: lines win
    when present, else the #268 defaults lane/issue-N and ~/aether-lane-N.
    Recorded as parsed (~ unexpanded); the shell sanitizes and expands at fold
    time — one expansion authority, on the side that runs the commands."""
    branch = f"lane/issue-{number}"
    worktree = f"~/aether-lane-{number}"
    if spec_text:
        branch_m = _BRANCH_RE.search(spec_text)
        worktree_m = _WORKTREE_RE.search(spec_text)
        if branch_m:
            branch = branch_m.group(1)
        if worktree_m:
            worktree = worktree_m.group(1)
    return branch, worktree


async def _fetch_issue(number: int) -> dict[str, Any]:
    """One github.get_issue hop. Raises MeshUnavailable; the caller maps it."""
    return await mesh_invoke("github.get_issue", {"number": number})


def _spec_text_of(issue: dict[str, Any]) -> str | None:
    """The text the targets parse from: the LATEST marker-carrying candidate
    (body first, then comments oldest→newest — a spec comment landed on a gap
    issue supersedes the gap body). None when nothing carries the marker."""
    candidates: list[str] = []
    body = issue.get("body")
    if isinstance(body, str):
        candidates.append(body)
    comments = issue.get("comments")
    if isinstance(comments, list):
        for comment in comments:
            if isinstance(comment, dict) and isinstance(comment.get("body"), str):
                candidates.append(comment["body"])
    marked = [text for text in candidates if _SPEC_MARKER_RE.search(text)]
    return marked[-1] if marked else None


def _append_lines(records: list[dict[str, Any]]) -> None:
    """Append the batch's request lines, one fsync covering all of them —
    the card must never see half a batch after a crash mid-append."""
    ledger = _ledger_path()
    ledger.parent.mkdir(parents=True, exist_ok=True)
    payload = "".join(json.dumps(rec) + "\n" for rec in records).encode("utf-8")
    fd = os.open(str(ledger), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        os.write(fd, payload)
        os.fsync(fd)
    finally:
        os.close(fd)


def _normalize_numbers(number: Any, numbers: Any) -> list[int] | None:
    """Collapse the number/numbers args to an ordered, de-duped int list.
    None = structurally unusable input (raven asks the user to repeat)."""
    raw: list[Any] = []
    if isinstance(numbers, list) and numbers:
        raw = numbers
    elif number is not None:
        raw = [number]
    out: list[int] = []
    for value in raw:
        if isinstance(value, bool):
            return None
        if isinstance(value, int) and value >= 1:
            n = value
        elif isinstance(value, float) and value.is_integer() and value >= 1:
            n = int(value)
        elif isinstance(value, str) and value.strip().isdigit():
            n = int(value.strip())
        else:
            return None
        if n not in out:
            out.append(n)
    return out or None


async def _work_on_issue(number: Any, numbers: Any, confirmed: bool) -> dict[str, Any]:
    wanted = _normalize_numbers(number, numbers)
    if wanted is None:
        return {"ok": False, "error": "no usable issue number"}
    if len(wanted) > BATCH_MAX:
        return {"ok": False, "error": f"too many issues in one breath (max {BATCH_MAX})"}

    # Already-armed guard (#394): an issue already holding a requested-or-
    # live lane record is refused at the source — duplicates are harmless
    # since the #397 fold; this makes them rare. Batches filter per-issue:
    # arm the rest, name the skipped. Runs BEFORE capacity so the skipped
    # (who already hold their slots) never inflate the capacity ask. Not
    # overridable by `confirmed` — that flag belongs to the spec guard.
    armed = _already_armed(wanted)
    skipped = [{"issue": n, "state": armed[n]} for n in wanted if n in armed]
    wanted = [n for n in wanted if n not in armed]
    if not wanted:
        return {"ok": False, "error": "already_armed", "already": skipped}

    # Capacity next (#268 addendum 2): a batch that cannot fit is refused
    # WHOLE before any spec talk — raven names the cap and asks which to
    # start now. Not overridable by `confirmed`; the cap is the cap.
    cap = _max_lanes()
    committed = _committed_count()
    remaining = max(0, cap - committed)
    if len(wanted) > remaining:
        return {
            "ok": False,
            "error": "capacity",
            "max_lanes": cap,
            "in_use": committed,
            "remaining": remaining,
            "requested": len(wanted),
        }

    issues: list[dict[str, Any]] = []
    for n in wanted:
        try:
            issue = await _fetch_issue(n)
        except MeshUnavailable as e:
            reason = getattr(e, "reason", None)
            if reason == "github_no_token":
                return {"ok": False, "error": "github token not configured"}
            if reason == "github_is_pull_request":
                return {"ok": False, "error": f"#{n} is a pull request, not an issue"}
            if reason == "github_api_error":
                # 404 lands here — the most likely api error for a spoken number.
                return {"ok": False, "error": f"could not read issue #{n}"}
            return {"ok": False, "error": "mesh unavailable", "detail": str(e)}
        if issue.get("state") == "closed":
            # A closed issue means merged or abandoned — spawning on it is
            # near-certainly a mis-heard number. Hard error, no override.
            return {"ok": False, "error": f"issue #{n} is closed"}
        issues.append(issue)

    # The spec guard (#268 pre-decision 2). Unspecced issues need the spoken
    # override: first call returns the pending ask naming them; only
    # confirmed: true arms anyway. gap-labeled issues pass through the same
    # check — a gap WITH a spec comment is the blessed path, not an override.
    unspecced = [
        {"number": issue.get("number"), "title": issue.get("title", "")}
        for issue in issues
        if _spec_text_of(issue) is None
    ]
    if unspecced and not confirmed:
        names = ", ".join(f"#{u['number']}" for u in unspecced)
        return {
            "pending": True,
            "unspecced": unspecced,
            "ask": (
                f"{names} carries no architect spec on the record — "
                "spawn anyway?"
            ),
        }

    batch_id = os.urandom(6).hex()
    ts = datetime.now(timezone.utc).isoformat()
    records: list[dict[str, Any]] = []
    lanes: list[dict[str, Any]] = []
    for issue in issues:
        n = int(issue.get("number", 0))
        title = str(issue.get("title", ""))
        spec_text = _spec_text_of(issue)
        branch, worktree = _targets_for_issue(n, spec_text)
        record: dict[str, Any] = {
            "id": os.urandom(8).hex(),
            "ts": ts,
            "kind": "lane",
            "batch_id": batch_id,
            "issue": n,
            "issue_title": title,
            "branch": branch,
            "worktree": worktree,
            "status": "requested",
        }
        # Sparse (#376): the key appears only when the spec opts in — an
        # absent key IS the default-off record, so old lines fold unchanged.
        if spec_text and _SUBMODULES_RE.search(spec_text):
            record["submodules"] = True
        records.append(record)
        lanes.append({"issue": n, "title": title})

    try:
        _append_lines(records)
    except OSError as e:
        return {"ok": False, "error": "could not record request", "detail": str(e)}

    print(f"[WORK_ON_ISSUE] armed batch {batch_id}: {[lane['issue'] for lane in lanes]}")
    result: dict[str, Any] = {"ok": True, "batch_id": batch_id, "count": len(lanes), "lanes": lanes}
    # Sparse, like the submodules key: present only when the guard filtered
    # the batch, so single-issue and clean-batch returns are unchanged.
    if skipped:
        result["skipped"] = skipped
    return result


_DESCRIPTION = (
    "ARM implementer lanes against GitHub issues from the board: 'work on "
    "issue 271' / 'work on 271, 272 and 280'. Pass ONE issue as `number` or "
    "several as `numbers` — a multi-issue utterance is ONE call, producing "
    "ONE approval card; the Director's single approve spawns all of them, "
    "cancel spawns none. NO passphrase — the card is the gate (unlike "
    "request_spawn). A SIDE-EFFECT tool like report_gap: it RECORDS the "
    "request and returns a tiny signal, NOT content to read aloud. Returns: "
    "{ ok: true, count } — say one line ('Armed, sir — approve on the "
    "card.'). { pending: true, ask } — one or more issues carry no ARCHITECT "
    "SPEC on the record; speak the ask and STOP; only if the user explicitly "
    "confirms, call again with the SAME numbers plus confirmed: true. "
    "{ ok: false, error: 'capacity', max_lanes, remaining } — the batch "
    "exceeds remaining lane capacity; name the cap and ask WHICH issues to "
    "start now (a follow-up call with that subset), never silently trim. "
    "{ ok: false, error: 'already_armed', already: [{ issue, state }] } — "
    "every named issue already has a lane in flight; refuse politely and "
    "point at the existing state ('already armed, sir — approve the card' "
    "for requested, 'lane #N is already live' for spawned, 'lane #N's "
    "teardown needs closing out first' for teardown_failed). NEVER retry "
    "with confirmed — duplicates are refused, period. A success may carry "
    "skipped (same shape): those issues were already in flight and left "
    "alone — name them alongside the armed ones. "
    "Other { ok: false } errors name the problem (closed issue, PR number, "
    "unreadable issue) — relay briefly. Distinct from report_gap (FILES a "
    "gap), review_gaps (PROPOSES), draft_lane (WRITES a prompt), and "
    "request_spawn (spawns a DRAFTED lane, passphrase-gated)."
)

_PARAMETERS = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "number": types.Schema(
            type=types.Type.INTEGER,
            description="The single issue number to work on ('work on issue 271').",
        ),
        "numbers": types.Schema(
            type=types.Type.ARRAY,
            items=types.Schema(type=types.Type.INTEGER),
            description=(
                "Several issue numbers from ONE utterance ('work on 271 and "
                "272') — one call, one card. Use instead of `number`."
            ),
        ),
        "confirmed": types.Schema(
            type=types.Type.BOOLEAN,
            description=(
                "Pass true ONLY after the user has just agreed, by voice, to "
                "spawn despite a missing architect spec. Never on the first call."
            ),
        ),
    },
)


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations: work_on_issue + its spoken alias."""
    work_on_issue = types.FunctionDeclaration(
        name="work_on_issue",
        description=_DESCRIPTION,
        parameters=_PARAMETERS,
    )
    spawn_lane = types.FunctionDeclaration(
        name="spawn_lane",
        description=(
            "Alias of work_on_issue — identical arguments and behaviour. Use "
            "when the user phrases it as 'spawn a lane for issue N'."
        ),
        parameters=_PARAMETERS,
    )
    return [types.Tool(function_declarations=[work_on_issue, spawn_lane])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — the get_issue hop rides the mesh."""
    if name in FUNCTIONS:
        return await _work_on_issue(
            number=args.get("number"),
            numbers=args.get("numbers"),
            confirmed=bool(args.get("confirmed", False)),
        )
    return None
