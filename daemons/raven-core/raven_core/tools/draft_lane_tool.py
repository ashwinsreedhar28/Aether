"""Draft Lane Tool - Turn an accepted build proposal into a paste-ready lane prompt.

The third rung of the Architect arc. ``review_gaps`` reads the gap log back so
raven can PROPOSE 1–3 lanes; ``draft_lane`` takes ONE accepted proposal and
composes a house-format lane prompt — the exact shape the Director pastes to an
Implementer session — then writes it to disk for the Director to pick up. The
flow: user asks "what should we build next" (review_gaps proposes), user says
"draft the lane for X" (this tool writes the prompt).

UNLIKE review_gaps (which RETURNS content for raven to reason over) this is a
SIDE-EFFECT tool like report_gap / notify: it writes the draft and returns a
tiny ``{ ok, path }`` ack, NOT content to read aloud. raven speaks ONE line
("Drafted, sir — in architect drafts.") and never recites the prompt.

The write is DIRECT to disk — a raven-local artifact, not mesh data — so there
is no mesh hop and no manifest edge (see DECISIONS.md, this lane's ADR). Drafts
land under ``<data-root>/architect/drafts/<slug>-<ts>.md`` where the data root
honours ``AETHER_DATA_DIR`` (the shared ``$userData/data`` root the Aether shell
hands raven-core, identical to every mesh node's), else falls back to
``RAVEN_USER_DIR`` and finally ``~/.raven`` for standalone runs — the same
precedence shape the memory store uses.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from google.genai import types

FUNCTIONS = ["draft_lane"]

# Where drafts live, namespaced under the resolved data root. A sibling of the
# per-node data dirs (news_feeds/, finance/, …) rather than buried in raven's
# private state — these are an Aether-wide Architect artifact, not raven memory.
DRAFTS_SUBPATH = ("architect", "drafts")


def _drafts_dir() -> Path:
    """Resolve the architect/drafts directory under the data root.

    Precedence: AETHER_DATA_DIR (the shared $userData/data root the shell's
    ravenDaemonManager passes raven-core, identical to every mesh node) →
    RAVEN_USER_DIR (raven's private dir; fallback when AETHER_DATA_DIR is unset)
    → ~/.raven (standalone CLI runs). Mirrors raven_core/memory/store.py's
    _default_user_dir resolution so the on-disk layout stays predictable across
    the daemon's launch modes.
    """
    base = os.environ.get("AETHER_DATA_DIR") or os.environ.get("RAVEN_USER_DIR")
    root = Path(base) if base else Path.home() / ".raven"
    return root.joinpath(*DRAFTS_SUBPATH)


def _slugify(name: str) -> str:
    """kebab-case slug for the filename, branch, and worktree placeholders."""
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return slug or "lane"


def _as_lines(value: Any) -> list[str]:
    """Normalise a list-or-string field into a clean list of non-empty lines.

    Gemini supplies scope_files / steps as ARRAYs, but tolerate a single
    newline-delimited string too (older shapes, manual calls). Either way we
    end up with trimmed, non-empty lines ready to bullet or number.
    """
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        items = [str(item).strip() for item in value]
    elif isinstance(value, str):
        items = [line.strip() for line in value.splitlines()] or [value.strip()]
    else:
        items = [str(value).strip()]
    return [item for item in items if item]


def _compose_lane_prompt(
    name: str,
    goal: str,
    scope_files: Any,
    steps: Any,
    smoke: str,
) -> str:
    """Deterministically assemble a house-format lane prompt.

    Shape mirrors the lanes the Director actually pastes (=== LANE … ===
    fences, role line, a fixed RECON-FIRST guardrail line, a fixed PRECEDENT
    line, branch/worktree, GOAL, SCOPE, numbered BUILD STEPS, Director-run
    smoke, the verify-then-ship Ship line, a PR title). Branch and worktree are
    derived placeholders the Architect can edit before dispatch — paste-ready
    defaults beat literal <fill-me> tokens. The RECON-FIRST line is fixed (not
    model-supplied) so a thin draft is self-limiting: a spawned implementer
    reads the named precedents and STOPS to report options rather than
    freelancing a design decision the draft didn't cover. The PRECEDENT line is
    likewise fixed: it routes the implementer to query the aether-rag corpus
    (search_corpus) for relevant decisions/patterns before each step, so
    discovery is precedent-first by default rather than dependent on the draft
    hand-listing every relevant file (CLAUDE.md §13.13).
    """
    slug = _slugify(name)
    title = (name or "").strip().upper() or "UNTITLED LANE"
    scope_lines = _as_lines(scope_files)
    step_lines = _as_lines(steps)
    smoke_text = (smoke or "").strip() or "(Director to define a smoke test before dispatch)"

    lines: list[str] = [
        f"=== LANE — {title} ===",
        "Implementer: Claude Code (Opus). Read CLAUDE.md (§7 self-review, "
        "§11 review heuristics, §13 prompt discipline) before writing a line.",
        "RECON FIRST: read the named precedents; if the approach requires a "
        "design decision not covered here, STOP and report options instead of "
        "building.",
        "PRECEDENT: query the aether-rag MCP (search_corpus) for decisions and "
        "patterns relevant to each step before implementing it.",
        f"Branch: feat/{slug}   Worktree: ~/aether-{slug}",
        "",
        f"GOAL: {(goal or '').strip() or '(Architect to state the one-sentence goal)'}",
        "",
        "SCOPE (files / surfaces in play):",
    ]
    if scope_lines:
        lines.extend(f"- {item}" for item in scope_lines)
    else:
        lines.append("- (none specified — Architect to fill before dispatch)")
    lines.extend(["", "BUILD STEPS:"])
    if step_lines:
        lines.extend(f"{i}. {step}" for i, step in enumerate(step_lines, start=1))
    else:
        lines.append("1. (no steps specified — Architect to fill before dispatch)")
    lines.extend([
        "",
        f"Smoke (Director): {smoke_text}",
        "",
        'Ship: run verify-build; on Director\'s "clean, proceed", run ship-it.',
        f"PR: feat({slug}): {(name or '').strip() or 'untitled lane'}",
        "=== END LANE ===",
        "",
    ])
    return "\n".join(lines)


def _draft_lane(
    name: str,
    goal: str,
    scope_files: Any,
    steps: Any,
    smoke: str,
) -> dict[str, Any]:
    name = (name or "").strip()
    if not name:
        return {"ok": False, "error": "missing lane name"}

    prompt = _compose_lane_prompt(name, goal, scope_files, steps, smoke)

    drafts_dir = _drafts_dir()
    slug = _slugify(name)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = drafts_dir / f"{slug}-{ts}.md"

    try:
        drafts_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(prompt, encoding="utf-8")
    except OSError as e:
        # The draft couldn't be written — return a tiny error signal so raven
        # can say it couldn't draft rather than claiming success. raven does
        # not narrate the detail.
        return {"ok": False, "error": "could not write draft", "detail": str(e)}

    print(f"[DRAFT_LANE] wrote lane prompt for '{name}' → {path}")
    return {"ok": True, "path": str(path)}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declaration for draft_lane."""
    func = types.FunctionDeclaration(
        name="draft_lane",
        description=(
            "Turn ONE accepted build proposal into a paste-ready, house-format "
            "lane prompt and write it to the architect drafts folder. Call it "
            "ONLY when the user accepts a proposal you just pitched and asks you "
            "to write it up — 'draft the lane for X', 'write the lane for that "
            "timers node', 'draft it'. This is a SIDE-EFFECT tool like "
            "report_gap and notify: it writes the draft and returns only a tiny "
            "{ ok, path } signal — NOT content to read aloud. After it returns, "
            "speak ONE short line of acknowledgement (e.g. 'Drafted, sir — in "
            "architect drafts.') and do NOT read the prompt, the path, or the "
            "steps back. You still only PROPOSE and DRAFT — writing the prompt "
            "is not building; the build remains the user's call. Supply the "
            "fields from the proposal you just made: the lane name, the "
            "one-sentence goal, the files/surfaces it would touch, the build "
            "steps, and a smoke test the Director can run."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "name": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Short lane name — the title of the accepted proposal "
                        "(e.g. 'Timers node', 'Smart-home control')."
                    ),
                ),
                "goal": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "One sentence describing what success looks like for "
                        "this lane."
                    ),
                ),
                "scope_files": types.Schema(
                    type=types.Type.ARRAY,
                    items=types.Schema(type=types.Type.STRING),
                    description=(
                        "The files, nodes, tools, prompts, or views this lane "
                        "would touch — one entry each (e.g. 'new nodes/timers "
                        "node', 'new timer voice tool', 'prompts.json')."
                    ),
                ),
                "steps": types.Schema(
                    type=types.Type.ARRAY,
                    items=types.Schema(type=types.Type.STRING),
                    description=(
                        "Ordered build steps for the Implementer — one entry "
                        "per step, in the order they should be done."
                    ),
                ),
                "smoke": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "A short smoke test the Director can run to confirm the "
                        "lane works (e.g. 'ask \"set a 5 minute timer\" → timer "
                        "fires')."
                    ),
                ),
            },
            required=["name", "goal"],
        ),
    )
    return [types.Tool(function_declarations=[func])]


def handle_call(name: str, args: dict) -> dict[str, Any] | None:
    """Sync tool handler — pure local file I/O, no mesh hop, no event loop."""
    if name == "draft_lane":
        return _draft_lane(
            name=args.get("name", ""),
            goal=args.get("goal", ""),
            scope_files=args.get("scope_files"),
            steps=args.get("steps"),
            smoke=args.get("smoke", ""),
        )
    return None
