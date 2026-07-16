"""Lane Gate Tool - Surface READY TO TEST lanes and their smoke steps by voice.

R1 of the revision loop (#340), riding the #310 lane channel: a spawned lane
posts its gate report to its own issue thread and stops at the gate; the
SMOKE section of that report is the Director's test script. These two tools
make that state askable instead of card archaeology:

  - ``whats_ready_to_test()``   → which lanes sit AT GATE right now
  - ``read_test_steps(number)`` → the latest gate report's smoke section,
                                  spoken as a short numbered walkthrough

Both are READ-ONLY and deliberately NOT confirm-gated (the standing #225
reversibility ruling — the confirm convention covers spawn/teardown/relay
class side effects; these tools touch nothing). Both ride the existing
``raven → github.get_issue`` manifest edge (work_on_issue precedent) and
return a ``spoken`` field pre-written for every path, success and failure
alike (music_tool precedent), so a miss is named ("No gate report on issue
336 yet, sir") rather than an error string read aloud.

AT GATE here mirrors the shell's fold EXACTLY (shell/src/utils/laneGate.ts,
the pull-based card fold): only comments STRICTLY NEWER than the lane
record's spawned event count; the latest GATE REPORT comment wins; a newer
PR OPENED comment upgrades the lane past the gate; DIRECTOR FEEDBACK
strictly newer than the report holds the lane REVISING (#339 — the lane
owes a revision, it is NOT ready to test), and the post-revision report
supersedes back to at-gate with zero clearing logic. Phase resolution is
``_gate_phase``, the exact Python mirror of laneGate.ts gatePhase(). The
prefix literals are duplicated here as on the renderer side — Python and TS
don't share imports; each side pins its copy in tests (#372, a #241
sibling-drift specimen).
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["whats_ready_to_test", "read_test_steps"]

# The #310 lane-channel comment prefixes, kept in sync with the kickoff
# template (spawnService.laneKickoff) and shell/src/utils/laneGate.ts.
# DIRECTOR FEEDBACK is the third prefix (#339, the R2 revision loop) —
# posted by the card's REVISE path, or by hand.
GATE_REPORT_PREFIX = "GATE REPORT"
PR_OPENED_PREFIX = "PR OPENED"
DIRECTOR_FEEDBACK_PREFIX = "DIRECTOR FEEDBACK"

# Same ledger work_on_issue appends to and lane_proceed folds.
SPAWNS_SUBPATH = ("spawns",)
LEDGER_NAME = "requests.jsonl"

_FALLBACK_SPOKEN = "I can't reach the board right now, sir."

# github node denies worth a friendlier line than the fallback.
_FRIENDLY_DENIES: dict[str, str] = {
    "github_no_token": "The board isn't configured, sir — no GitHub token.",
    "github_not_found": "There's no issue by that number on the board, sir.",
    "github_is_pull_request": "That number is a pull request, sir, not a lane issue.",
}


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


def _parse_ts(value: Any) -> datetime | None:
    """ISO timestamp → aware datetime; None when unusable (the renderer's
    rule: an unparseable timestamp never passes a newer-than guard)."""
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


# ---------------------------------------------------------------- ledger fold


def _live_lanes() -> list[dict[str, Any]]:
    """Fold the ledger for every lane with a LIVE record, returning
    ``{ issue, title, spawned_at }`` per lane (spawned_at None when the
    spawned event carried no parseable ts — that lane folds to 'working',
    mirroring the renderer's never-passes guard). Relay/teardown lines are
    skipped wholesale by kind. Per-issue resolution is status FIRST, newest
    among the live — spawnService.liveLane's rule, as in lane_proceed_tool
    (#383): liveness is a property of records, not issues."""
    ledger = _ledger_path()
    if not ledger.is_file():
        return []
    try:
        raw = ledger.read_text(encoding="utf-8")
    except OSError:
        return []
    lane_ids_by_issue: dict[int, list[str]] = {}
    title_by_id: dict[str, str] = {}
    status_by_id: dict[str, str] = {}
    spawned_ts_by_id: dict[str, str] = {}
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
        issue = obj.get("issue")
        if obj.get("kind") == "lane" and isinstance(issue, int):
            ids = lane_ids_by_issue.setdefault(issue, [])
            if rec_id not in ids:
                ids.append(rec_id)
            title = obj.get("issue_title")
            if isinstance(title, str):
                title_by_id[rec_id] = title
        status = obj.get("status")
        if isinstance(status, str):
            status_by_id[rec_id] = status
            if status == "spawned" and isinstance(obj.get("ts"), str):
                spawned_ts_by_id[rec_id] = obj["ts"]
    lanes: list[dict[str, Any]] = []
    for issue, ids in sorted(lane_ids_by_issue.items()):
        # The newest LIVE record wins (#383): a dead newer duplicate — the
        # July-14 374 shape, a second arm that failed preflight and was
        # dismissed — must never mask the live lane beside it. Only an issue
        # with NO spawned record folds out.
        live = next((i for i in reversed(ids) if status_by_id.get(i) == "spawned"), None)
        if live is None:
            continue
        lanes.append(
            {
                "issue": issue,
                "title": title_by_id.get(live, ""),
                "spawned_at": _parse_ts(spawned_ts_by_id.get(live)),
            }
        )
    return lanes


# ------------------------------------------------------------------ gate fold


def _fold_gate(comments: Any, spawned_at: datetime | None) -> dict[str, Any]:
    """The shell's foldGateComments, mirrored: latest GATE REPORT / PR OPENED /
    DIRECTOR FEEDBACK comment strictly newer than the spawn (the guard covers
    all three prefixes — a previous run's feedback is as inert as its report);
    unparseable timestamps (either side) never pass. ``report_at`` /
    ``feedback_at`` carry the winning comments' parsed timestamps, the inputs
    to ``_gate_phase``'s REVISING comparison."""
    state: dict[str, Any] = {
        "report": None,
        "report_at": None,
        "pr": False,
        "feedback": None,
        "feedback_at": None,
    }
    if not isinstance(comments, list) or spawned_at is None:
        return state
    for c in comments:
        if not isinstance(c, dict):
            continue
        body = c.get("body")
        at = _parse_ts(c.get("created_at"))
        if not isinstance(body, str) or at is None or at <= spawned_at:
            continue
        lead = body.lstrip()
        if lead.startswith(GATE_REPORT_PREFIX):
            state["report"] = body
            state["report_at"] = at
        elif lead.startswith(PR_OPENED_PREFIX):
            state["pr"] = True
        elif lead.startswith(DIRECTOR_FEEDBACK_PREFIX):
            state["feedback"] = body
            state["feedback_at"] = at
    return state


def _gate_phase(gate: dict[str, Any] | None) -> str:
    """laneGate.ts gatePhase(), mirrored exactly: pure precedence, no clearing
    logic anywhere. PR OPENED wins outright; a report with feedback STRICTLY
    newer than it is 'revising' (the lane owes a revision); a report otherwise
    is 'at-gate'; anything else — including preemptive feedback posted before
    any report — is still 'working'. A post-revision report is newer than the
    feedback, so latest-wins flips the phase back to 'at-gate' on its own:
    supersession IS the clear."""
    if gate is None:
        return "working"
    if gate["pr"]:
        return "pr-opened"
    if gate["report"] is None:
        return "working"
    if (
        gate["feedback_at"] is not None
        and gate["report_at"] is not None
        and gate["feedback_at"] > gate["report_at"]
    ):
        return "revising"
    return "at-gate"


def _latest_gate_report(comments: Any) -> str | None:
    """The LATEST GATE REPORT comment on the issue, no spawn guard —
    read_test_steps works on any issue by number, lane record or not
    (get_issue serves comments oldest-first, so last match wins)."""
    if not isinstance(comments, list):
        return None
    report: str | None = None
    for c in comments:
        if not isinstance(c, dict):
            continue
        body = c.get("body")
        if isinstance(body, str) and body.lstrip().startswith(GATE_REPORT_PREFIX):
            report = body
    return report


# ------------------------------------------------------------ smoke extraction

# A smoke-section opener: a markdown heading containing "smoke" ("## SMOKE",
# "## Director smoke (needs live mesh)"), or a short standalone line leading
# with it ("SMOKE (Director):", "**Director smoke**"). The section runs to
# the next heading or bold-only header line.
_HEADING = re.compile(r"^#{1,6}\s")
_BOLD_HEADER = re.compile(r"^\*\*[^*]+\*\*:?\s*$")
_SMOKE_OPENER = re.compile(r"^(?:#{1,6}\s+|\*\*)?\s*(?:director[\s-])?smoke\b", re.IGNORECASE)
_STEP = re.compile(r"^\s*(?:\d+[.)]\s+|[-*]\s+)(.*)$")


def _smoke_section(report: str) -> list[str] | None:
    """The smoke section's lines (heading excluded), or None when the report
    has no such section."""
    lines = report.splitlines()
    start: int | None = None
    for i, line in enumerate(lines):
        candidate = line.strip()
        if not candidate or len(candidate) > 100:
            continue
        is_header = bool(_HEADING.match(candidate) or _BOLD_HEADER.match(candidate))
        if is_header and "smoke" in candidate.lower() and _SMOKE_OPENER.match(candidate):
            start = i + 1
            break
        # A bare "SMOKE (Director):" opener line outside markdown headings.
        if not is_header and _SMOKE_OPENER.match(candidate) and candidate.endswith(":"):
            start = i + 1
            break
    if start is None:
        return None
    section: list[str] = []
    for line in lines[start:]:
        stripped = line.strip()
        if _HEADING.match(stripped) or _BOLD_HEADER.match(stripped):
            break
        section.append(line)
    return section


def _smoke_steps(section: list[str]) -> list[str]:
    """Numbered/bulleted items from the section, continuation lines folded
    into their step; empty when the section is plain prose."""
    steps: list[str] = []
    for line in section:
        m = _STEP.match(line)
        if m:
            steps.append(m.group(1).strip())
        elif steps and line.strip():
            steps[-1] += " " + line.strip()
    return [s for s in (_despeak(s) for s in steps) if s]


def _despeak(text: str) -> str:
    """Markdown → speakable: links to their text, code/bold/italic marks
    dropped, whitespace collapsed."""
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = text.replace("`", "").replace("**", "").replace("__", "")
    return re.sub(r"\s+", " ", text).strip()


def _clean_title(title: str) -> str:
    """Issue title → spoken phrase: the conventional-commit lead
    ("feat(music): ") dropped, the description kept."""
    return re.sub(r"^\w+\([^)]*\)!?:\s*", "", title).strip() or title.strip()


def _deny_result(e: MeshUnavailable) -> dict[str, Any]:
    """Translate a mesh failure into { error, spoken } Gemini can relay."""
    reason = e.reason or "mesh_unavailable"
    return {
        "error": reason,
        "spoken": _FRIENDLY_DENIES.get(reason, _FALLBACK_SPOKEN),
        "detail": str(e),
    }


# ------------------------------------------------------------------ the tools


async def _whats_ready_to_test() -> dict[str, Any]:
    live = _live_lanes()
    if not live:
        return {
            "ok": True,
            "count": 0,
            "lanes": [],
            "spoken": "No lanes are live right now, sir.",
        }

    ready: list[dict[str, Any]] = []
    unchecked: list[int] = []
    for lane in live:
        try:
            issue = await mesh_invoke("github.get_issue", {"number": lane["issue"]})
        except MeshUnavailable as e:
            # github_no_token / mesh-down fails every lane the same way —
            # one friendly line beats a per-lane litany.
            if lane is live[0] and e.reason in (None, "github_no_token"):
                return _deny_result(e)
            unchecked.append(lane["issue"])
            continue
        gate = _fold_gate(issue.get("comments"), lane["spawned_at"])
        if _gate_phase(gate) == "at-gate":
            title = issue.get("title")
            ready.append(
                {
                    "issue": lane["issue"],
                    "title": title if isinstance(title, str) else lane["title"],
                }
            )

    if ready:
        if len(ready) == 1:
            spoken = f"Lane {ready[0]['issue']} is ready, sir: {_clean_title(ready[0]['title'])}."
        else:
            named = "; ".join(f"{r['issue']} — {_clean_title(r['title'])}" for r in ready)
            spoken = f"{len(ready)} lanes are ready, sir: {named}."
    else:
        spoken = f"Nothing's at the gate yet, sir — {len(live)} lane{'s' if len(live) != 1 else ''} still working."
    if unchecked:
        spoken += f" I couldn't check lane {', '.join(str(n) for n in unchecked)}."

    result: dict[str, Any] = {"ok": True, "count": len(ready), "lanes": ready, "spoken": spoken}
    if unchecked:
        result["unchecked"] = unchecked
    return result


async def _read_test_steps(number: Any) -> dict[str, Any]:
    n = _normalize_number(number)
    if n is None:
        return {
            "ok": False,
            "error": "no usable lane number",
            "spoken": "Which lane, sir? I need its issue number.",
        }
    try:
        issue = await mesh_invoke("github.get_issue", {"number": n})
    except MeshUnavailable as e:
        return _deny_result(e)

    report = _latest_gate_report(issue.get("comments"))
    if report is None:
        # The named miss, by spec: no gate report on the thread yet.
        return {
            "ok": False,
            "issue": n,
            "error": "no_gate_report",
            "spoken": f"No gate report on issue {n} yet, sir — that lane hasn't reached its gate.",
        }

    section = _smoke_section(report)
    if section is None:
        return {
            "ok": False,
            "issue": n,
            "error": "no_smoke_section",
            "spoken": f"Lane {n}'s gate report carries no smoke section, sir.",
        }

    steps = _smoke_steps(section)
    if steps:
        walkthrough = " ".join(f"Step {i}: {s}" for i, s in enumerate(steps, 1))
        spoken = (
            f"Lane {n}'s smoke walkthrough, sir — "
            f"{len(steps)} step{'s' if len(steps) != 1 else ''}. {walkthrough}"
        )
    else:
        # A prose smoke section — speak it whole rather than inventing steps.
        prose = _despeak(" ".join(line.strip() for line in section if line.strip()))
        steps = [prose]
        spoken = f"Lane {n}'s smoke check, sir: {prose}"
    return {"ok": True, "issue": n, "steps": steps, "spoken": spoken}


_READY_DESCRIPTION = (
    "List the lanes currently AT THEIR GATE — build done, gate report posted "
    "to the issue thread, waiting on the user's smoke test before 'clean, "
    "proceed'. A lane revising against newer DIRECTOR FEEDBACK is NOT ready "
    "— it owes a revision and is counted as still working. Use for 'what's "
    "ready to test', 'anything at the gate', 'what's waiting on me'. "
    "READ-ONLY, no confirmation: it touches nothing. "
    "Returns { ok, count, lanes: [{ issue, title }], spoken } — read the "
    "`spoken` field verbatim and stop; never enumerate raw titles or JSON. "
    "Distinct from lane_proceed (RELAYS the go-ahead, confirm-gated), "
    "read_test_steps (reads ONE lane's smoke steps), and show_lane_card "
    "(raises the card on screen)."
)

_STEPS_DESCRIPTION = (
    "Read back HOW TO TEST a lane: fetches the LATEST gate report from the "
    "lane's issue thread, extracts its SMOKE section, and returns the steps "
    "as a spoken numbered walkthrough. Use for 'how do I test lane 334', "
    "'read me the test steps for 334', 'what's the smoke for that lane'. "
    "READ-ONLY, no confirmation: it touches nothing. Every result carries a "
    "`spoken` field pre-written for the situation — success, no-gate-report-"
    "yet, no-smoke-section — read it verbatim and stop; never read the raw "
    "report or error reasons aloud. Distinct from lane_proceed (RELAYS the "
    "go-ahead, confirm-gated) and whats_ready_to_test (lists ALL gated lanes)."
)

_STEPS_PARAMETERS = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "number": types.Schema(
            type=types.Type.INTEGER,
            description="The lane's issue number ('how do I test lane 334' → 334).",
        ),
    },
    required=["number"],
)


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for the two gate-surfacing reads."""
    whats_ready = types.FunctionDeclaration(
        name="whats_ready_to_test",
        description=_READY_DESCRIPTION,
        parameters=types.Schema(type=types.Type.OBJECT, properties={}),
    )
    read_steps = types.FunctionDeclaration(
        name="read_test_steps",
        description=_STEPS_DESCRIPTION,
        parameters=_STEPS_PARAMETERS,
    )
    return [types.Tool(function_declarations=[whats_ready, read_steps])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — the get_issue hops ride the mesh."""
    if name == "whats_ready_to_test":
        return await _whats_ready_to_test()
    if name == "read_test_steps":
        return await _read_test_steps(args.get("number"))
    return None
