"""Draft Spec Tool - Compose a machine-drafted candidate spec onto a gap issue.

Rung 1.5 of the Architect arc (#312). ``draft_lane`` (rung 1) writes a lane
PROMPT to disk from a proposal raven just pitched; ``draft_spec`` goes one
rung deeper into the failure-driven pattern: it takes a GAP ISSUE from the
board and runs the standalone composer at
``daemons/architect-draft/compose_spec.py`` — corpus retrieval (aether-rag)
plus the Director-configured draft model — which posts the result back onto
the issue thread as a comment prefixed "DRAFT SPEC (machine-composed,
unratified) — ".

The draft NEVER ratifies: the composer defangs and hard-checks its output
against the line-anchored spec guard (regex parity with ``_SPEC_MARKER_RE``
in work_on_issue_tool.py, pinned by tests/test_draft_spec_gate.py), so
``work_on_issue`` still warns the issue is spec-less until the Director
re-posts the agreed content under the real all-caps marker.

Gating: CONFIRM-GATED, two-turn like report_gap — the first call stages
nothing and returns ``{ pending, ask }``; only a second call with
``confirmed: true`` runs the composer. No auto knob: a model call plus a
public GitHub write should never ride a misheard sentence. No passphrase
either (work_on_issue's reasoning: the utterance names a board-vetted issue
and the comment is reversible — delete it — unlike a spawned lane).

Like report_gap this is a SIDE-EFFECT tool: the posted comment is the only
artifact, the return is a tiny ``{ ok, number, url }`` signal, and raven
speaks ONE line — it never reads the draft aloud. The composer runs as a
subprocess in its own venv (fastembed + google-genai live there, not in
raven-core's); this module only locates it, times it, and relays its one
JSON result line.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from google.genai import types

FUNCTIONS = ["draft_spec"]

# tools/ → raven_core → raven-core → daemons → <repo root>. Stable because
# raven-core always runs from the repo checkout (the daemons/README lifecycle).
_REPO_ROOT = Path(__file__).resolve().parents[4]
COMPOSER_DIR = _REPO_ROOT / "daemons" / "architect-draft"
COMPOSER_SCRIPT = COMPOSER_DIR / "compose_spec.py"
COMPOSER_PYTHON = COMPOSER_DIR / ".venv" / "bin" / "python"

# Corpus retrieval (embedding-model load) + a strong-model call + two REST
# hops. Generous on purpose; the kill on timeout keeps a hung composer from
# wedging the orchestrator's tool turn forever.
COMPOSER_TIMEOUT_S = 240

# The exact ask raven speaks while a composition awaits confirmation — one
# literal string shared by the tool return, the description, and the tests.
CONFIRM_ASK_TEMPLATE = (
    "Compose a machine draft spec on issue #{number}? It posts as an "
    "unratified comment."
)


def _normalize_number(value: Any) -> int | None:
    """One issue number from a spoken arg. Mirrors work_on_issue's
    normalization: bools are structurally unusable, not integers."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 1:
        return value
    if isinstance(value, float) and value.is_integer() and value >= 1:
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


async def _run_composer(number: int) -> tuple[int | None, str, str]:
    """The subprocess seam (tests patch this): run the composer, return
    (returncode, stdout, stderr). Raises asyncio.TimeoutError on overrun."""
    proc = await asyncio.create_subprocess_exec(
        str(COMPOSER_PYTHON),
        str(COMPOSER_SCRIPT),
        str(number),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(COMPOSER_DIR),
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=COMPOSER_TIMEOUT_S)
    except asyncio.TimeoutError:
        proc.kill()
        raise
    return proc.returncode, stdout.decode("utf-8", "replace"), stderr.decode("utf-8", "replace")


def _last_json_line(stdout: str) -> dict[str, Any] | None:
    """The composer's contract: exactly one JSON result line on stdout, last.
    Tolerate stray earlier lines; a non-JSON tail is a broken run."""
    for line in reversed(stdout.splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except ValueError:
            return None
        return payload if isinstance(payload, dict) else None
    return None


async def _draft_spec(number: Any, confirmed: bool) -> dict[str, Any]:
    n = _normalize_number(number)
    if n is None:
        return {"ok": False, "error": "no usable issue number"}

    # The voice gate. Nothing runs on the pending path — a declined offer
    # leaves no trace, no model call, no GitHub write.
    if not confirmed:
        return {"pending": True, "ask": CONFIRM_ASK_TEMPLATE.format(number=n)}

    if not COMPOSER_PYTHON.exists():
        return {
            "ok": False,
            "error": "composer venv missing",
            "detail": (
                f"create it: cd {COMPOSER_DIR} && python3 -m venv .venv && "
                ".venv/bin/pip install -r requirements.txt"
            ),
        }

    try:
        returncode, stdout, stderr = await _run_composer(n)
    except asyncio.TimeoutError:
        return {"ok": False, "error": f"composer timed out after {COMPOSER_TIMEOUT_S}s"}
    except OSError as e:
        return {"ok": False, "error": "could not run composer", "detail": str(e)}

    payload = _last_json_line(stdout)
    if payload is None:
        # No JSON contract line at all — surface a stderr tail for the logs;
        # raven only says it couldn't draft.
        return {
            "ok": False,
            "error": "composer produced no result line",
            "detail": stderr.strip()[-300:],
        }
    if returncode != 0 or not payload.get("ok"):
        # The composer's own named refusal (closed issue, already-ratified,
        # missing model config, …) — relay it verbatim, it is already clean.
        return {"ok": False, "error": str(payload.get("error") or "composer failed")}

    print(f"[DRAFT_SPEC] draft posted on #{n}: {payload.get('url')}")
    return {"ok": True, "number": n, "url": payload.get("url")}


_DESCRIPTION = (
    "Compose a MACHINE-DRAFTED candidate spec for a GAP issue and post it on "
    "that issue's thread: 'draft a spec for issue 311'. Runs the Rung 1.5 "
    "composer (corpus retrieval + the Director-configured draft model); the "
    "comment is marked unratified and can NEVER certify the issue — 'work on "
    "issue N' still warns no-spec until the Director ratifies by re-posting "
    "the real marker. TWO-TURN: the first call returns { pending, ask } — "
    "speak the ask and STOP; only if the user explicitly confirms, call "
    "again with the SAME number plus confirmed: true. It takes up to a "
    "couple of minutes — say you're on it, and NEVER call twice for one "
    "ask. A SIDE-EFFECT tool like report_gap: returns a tiny { ok, url } "
    "signal, NOT content to read aloud — acknowledge with one line "
    "('Drafted on the issue, sir — unratified.'). { ok: false } names the "
    "problem (closed issue, already has a ratified spec, composer not set "
    "up) — relay briefly. Distinct from draft_lane (writes a lane PROMPT to "
    "disk from a proposal) and work_on_issue (ARMS an implementer lane)."
)

_PARAMETERS = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "number": types.Schema(
            type=types.Type.INTEGER,
            description="The gap issue number to draft a spec for ('draft a spec for issue 311').",
        ),
        "confirmed": types.Schema(
            type=types.Type.BOOLEAN,
            description=(
                "Pass true ONLY after the user has just agreed, by voice, to "
                "compose and post the draft. Never on the first call."
            ),
        ),
    },
    required=["number"],
)


def get_tools() -> list[types.Tool]:
    """Return Gemini function declaration for draft_spec."""
    func = types.FunctionDeclaration(
        name="draft_spec",
        description=_DESCRIPTION,
        parameters=_PARAMETERS,
    )
    return [types.Tool(function_declarations=[func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — the composer subprocess rides the event loop."""
    if name == "draft_spec":
        return await _draft_spec(
            number=args.get("number"),
            confirmed=bool(args.get("confirmed", False)),
        )
    return None
