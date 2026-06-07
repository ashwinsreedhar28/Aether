"""Request Spawn Tool - Arm a human-gated self-build spawn.

Rung 2 of the Architect arc. ``draft_lane`` (rung 1) wrote an accepted proposal
to disk as a paste-ready lane prompt; ``request_spawn`` HANDS one of those drafts
to a fresh Implementer — but only with the spoken passphrase, and only as a
*request* the Director must then approve on a card in the shell. The actual
worktree + Terminal launch happens shell-side (see
``shell/electron/main/services/spawnService.ts``); this tool only RECORDS the
request, so the human gate is preserved by construction.

Flow: user says "spawn the <X> lane" and speaks the passphrase → raven calls
request_spawn(draft='<X>', passphrase='<spoken>'). The passphrase is compared
constant-time against ``AETHER_SPAWN_PHRASE`` (the shell hands raven-core this
env var, sourced from .env.local). Wrong or absent → refuse with NO detail (raven
says only that it couldn't arm it). Right → resolve the named draft under
``<data-root>/architect/drafts`` and append a ``status: "requested"`` line to
``<data-root>/spawns/requests.jsonl`` (append + fsync, the same durability the
intents/gap ledger uses). The shell watches that ledger and raises the approval
card.

UNLIKE report_gap/review_gaps this takes no mesh hop — like draft_lane it writes
a raven-local artifact straight to disk, so there is no manifest edge (see the
spawn-actor ADR in DECISIONS.md). It is a SIDE-EFFECT tool: it returns a tiny
``{ ok, id }`` (or ``{ ok: false }`` on refusal) and raven speaks ONE line; it
NEVER reads the prompt, the path, or the passphrase back.

Security: the passphrase value never appears in any return field, log line, or
spoken response. The transcript store separately scrubs the live phrase from
persisted transcripts (see daemons/raven-daemon/src/transcriptStore.ts).
"""
from __future__ import annotations

import hmac
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from google.genai import types

FUNCTIONS = ["request_spawn"]

# Sibling subtrees under the resolved data root. Drafts are written by draft_lane;
# the spawn ledger is the append-only request log the shell's SpawnService folds.
DRAFTS_SUBPATH = ("architect", "drafts")
SPAWNS_SUBPATH = ("spawns",)
LEDGER_NAME = "requests.jsonl"


def _data_root() -> Path:
    """Resolve the shared data root.

    Precedence mirrors draft_lane / the memory store: AETHER_DATA_DIR (the shared
    $userData/data root the shell's ravenDaemonManager passes raven-core,
    identical to every mesh node) → RAVEN_USER_DIR (raven's private dir) → ~/.raven
    (standalone CLI runs). The shell-side SpawnService reads the same
    $userData/data/spawns/requests.jsonl, so the two halves agree on the path.
    """
    base = os.environ.get("AETHER_DATA_DIR") or os.environ.get("RAVEN_USER_DIR")
    return Path(base) if base else Path.home() / ".raven"


def _drafts_dir() -> Path:
    return _data_root().joinpath(*DRAFTS_SUBPATH)


def _ledger_path() -> Path:
    return _data_root().joinpath(*SPAWNS_SUBPATH, LEDGER_NAME)


def _slugify(name: str) -> str:
    """kebab-case slug — must match the shell's slugify so the worktree/branch the
    Director sees on the card derives identically (feat/<slug>, ~/aether-<slug>)."""
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return slug or "lane"


def _passphrase_ok(provided: str) -> bool:
    """Constant-time compare against AETHER_SPAWN_PHRASE.

    Returns False if the env var is unset/empty OR the provided phrase is
    empty OR they differ. compare_digest keeps the comparison timing-independent;
    the length guards short-circuit only the trivially-empty cases (never on the
    secret's content), which does not leak the secret.
    """
    expected = os.environ.get("AETHER_SPAWN_PHRASE") or ""
    provided = provided or ""
    if not expected or not provided:
        return False
    return hmac.compare_digest(expected, provided)


def _resolve_draft(draft: str) -> Path | None:
    """Resolve a draft by absolute/explicit path or by name within the drafts dir.

    By name: slugify the spoken name and match the newest draft file whose stem is
    the slug or begins ``<slug>-`` (draft_lane writes ``<slug>-<ts>.md``); fall
    back to a looser slug-substring match. Newest wins (the ts in the filename
    sorts lexically). Returns None if nothing matches.
    """
    if not draft:
        return None
    explicit = Path(draft).expanduser()
    if explicit.is_file():
        return explicit

    drafts_dir = _drafts_dir()
    if not drafts_dir.is_dir():
        return None
    slug = _slugify(draft)
    candidates = sorted(drafts_dir.glob("*.md"))
    matches = [f for f in candidates if f.stem == slug or f.stem.startswith(slug + "-")]
    if not matches:
        matches = [f for f in candidates if slug in _slugify(f.stem)]
    if not matches:
        return None
    return matches[-1]


def _append_request(rec: dict[str, Any]) -> None:
    """Append one JSON line to the spawn ledger, fsync'd before returning.

    open(O_APPEND) + write + fsync mirrors the intents/gap store durability so a
    crash right after raven's ack cannot lose the request. O_APPEND keeps the
    write atomic against the shell's concurrent lifecycle appends.
    """
    ledger = _ledger_path()
    ledger.parent.mkdir(parents=True, exist_ok=True)
    line = (json.dumps(rec) + "\n").encode("utf-8")
    fd = os.open(str(ledger), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        os.write(fd, line)
        os.fsync(fd)
    finally:
        os.close(fd)


def _request_spawn(draft: str, passphrase: str) -> dict[str, Any]:
    # Refuse FIRST, before touching the filesystem or revealing whether the draft
    # exists — a wrong phrase must learn nothing. No detail in the return; raven
    # says only that it couldn't arm the spawn.
    if not _passphrase_ok(passphrase):
        return {"ok": False}

    resolved = _resolve_draft(draft)
    if resolved is None:
        # Phrase was right but the named draft isn't on disk. Distinct from a
        # refusal — raven can say it couldn't find that draft (no secret leaks).
        return {"ok": False, "error": "no such draft"}

    rec = {
        "id": os.urandom(8).hex(),
        "ts": datetime.now(timezone.utc).isoformat(),
        "draft_path": str(resolved),
        "draft_name": _slugify(draft),
        "status": "requested",
    }
    try:
        _append_request(rec)
    except OSError as e:
        return {"ok": False, "error": "could not record request", "detail": str(e)}

    print(f"[REQUEST_SPAWN] armed spawn '{rec['draft_name']}' → {resolved}")
    return {"ok": True, "id": rec["id"]}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declaration for request_spawn."""
    func = types.FunctionDeclaration(
        name="request_spawn",
        description=(
            "ARM a self-build spawn: hand an accepted draft lane to a fresh "
            "Implementer. Call it ONLY when the user asks to 'spawn the <X> "
            "lane' AND provides a spoken passphrase. Pass the passphrase EXACTLY "
            "as heard in `passphrase`; it is checked server-side and you must "
            "NEVER repeat, confirm, spell, or acknowledge its value. If the user "
            "gives no passphrase, ask for it once without revealing what it is — "
            "do not call this tool yet. This is a SIDE-EFFECT tool like "
            "report_gap: it RECORDS a spawn request (which the Director then "
            "approves on a card in the shell) and returns only a tiny "
            "{ ok, id } signal — NOT content to read aloud. On { ok: false } it "
            "refused or the draft wasn't found; say only that you couldn't arm "
            "it, with no detail. Spawning stays human-gated: this only requests; "
            "you never start the build yourself. Distinct from draft_lane, which "
            "WRITES the lane prompt — request_spawn HANDS an existing draft to an "
            "implementer."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "draft": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "The draft lane to spawn — the short name of the lane the "
                        "user named (e.g. 'smart home', 'timers'). Matched against "
                        "the drafts draft_lane wrote; an explicit file path also "
                        "works."
                    ),
                ),
                "passphrase": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "The spawn passphrase the user spoke, verbatim. Required. "
                        "Never repeated, confirmed, or read back under any "
                        "circumstance."
                    ),
                ),
            },
            required=["draft", "passphrase"],
        ),
    )
    return [types.Tool(function_declarations=[func])]


def handle_call(name: str, args: dict) -> dict[str, Any] | None:
    """Sync tool handler — pure local file I/O, no mesh hop, no event loop."""
    if name == "request_spawn":
        return _request_spawn(
            draft=args.get("draft", ""),
            passphrase=args.get("passphrase", ""),
        )
    return None
