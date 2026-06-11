#!/usr/bin/env python3
"""Compose a machine-drafted candidate spec for a gap issue — Rung 1.5 skeleton.

Pipeline (one issue number in, one posted comment out):

    fetch the gap issue (GitHub REST, PAT in env — the #256 pre-decision:
    a fine-grained PAT is deterministic where gh's auth state is host-
    dependent; same env contract as nodes/github)
      → retrieve precedent from the local aether-rag corpus (imports the
        sibling spike's rag_lib — the SAME primitive the search_corpus MCP
        tool wraps; see daemons/aether-rag/server.py)
      → prompt the Director-configured draft model (google-genai; the model
        id comes from config, NEVER from code — an unconfigured model is an
        instructive refusal, not a silent default)
      → sanitize + assemble the comment under the literal prefix
        "DRAFT SPEC (machine-composed, unratified) — "
      → post it as an issue comment; print one JSON result line to stdout.

GUARD INTERACTION — the load-bearing clause (#312). The spawn path treats
an issue as a contract only when a line opens with the all-caps ratification
marker (the line-anchored regex in raven_core/tools/work_on_issue_tool.py,
duplicated below as SPEC_GUARD_RE with a parity test pinning the two). A
machine draft must NEVER produce a body that matches it: ``defang`` block-
quotes any would-match line (the gap.ts idiom — content preserved, anchor
broken), and ``_assert_unguarded`` hard-refuses to post if a violating body
somehow survives. Ratification stays human: the Director re-posts agreed
content under the real marker; this script cannot.

Standalone by design: runnable from a terminal against a live issue with no
mesh, no shell, no MCP session up. The raven voice tool (draft_spec) shells
out to this script and relays the JSON result line.

Env:    AETHER_GITHUB_REPO, AETHER_GITHUB_TOKEN (issue read + comment write),
        GEMINI_API_KEY (the model call),
        AETHER_DRAFT_MODEL (optional — overrides the config file).
Config: <data-root>/architect/config.json  { "draft_model": "<model-id>" }
        where data-root resolves AETHER_DATA_DIR → RAVEN_USER_DIR → ~/.raven
        (the draft_lane_tool precedence).
Heavy imports (fastembed via rag_lib, google-genai) stay lazy so
`python3 -m compileall` and the unit tests run dep-free.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
RAG_DIR = HERE.parent / "aether-rag"

# The record-not-contract marker guard. REGEX PARITY with
# raven_core/tools/work_on_issue_tool.py:_SPEC_MARKER_RE (the spawn-side
# authority) — pinned by tests/test_draft_spec_gate.py in raven-core. If the
# guard ever changes shape, change BOTH and keep the parity test green.
SPEC_GUARD_RE = re.compile(r"^\s*(?:=+\s*)?ARCHITECT SPEC", re.MULTILINE)

# The literal comment-opening prefix (#312 item 2). Consumers (humans, a
# future card fold) match on this; it deliberately cannot satisfy the guard.
DRAFT_PREFIX = "DRAFT SPEC (machine-composed, unratified) — "

# GitHub REST contract — mirrors nodes/github/src/github.ts (headers,
# timeout, token only ever in the Authorization header, never in output).
API_ROOT = "https://api.github.com"
REQUEST_TIMEOUT_S = 10
COMMENTS_LIMIT = 100  # one page, oldest-first — parity with get_issue

# Model config knob. Env wins (single-sourced from .env.local, the
# AETHER_SPAWN_MAX_LANES shape); the config file covers standalone runs.
MODEL_ENV = "AETHER_DRAFT_MODEL"
CONFIG_SUBPATH = ("architect", "config.json")
CONFIG_KEY = "draft_model"

# Retrieval bounds — a gap record yields at most 3 queries; the prompt
# carries at most 8 deduped passages so precedent stays context, not bulk.
RAG_QUERIES_MAX = 3
RAG_K_PER_QUERY = 4
RAG_PASSAGES_MAX = 8

# Prompt assembly bounds (chars). Truncating here keeps a pathological gap
# thread from blowing the model context; the draft is a skeleton, not a wiki.
BODY_MAX = 4000
COMMENT_MAX = 1000
COMMENTS_IN_PROMPT_MAX = 10
PASSAGE_MAX = 1200


class ComposeError(RuntimeError):
    """A named, user-facing refusal — printed as the JSON error and exit 1."""


class GuardViolation(ComposeError):
    """A composed body matched the spec guard after sanitizing. Never posted."""


def _log(message: str) -> None:
    """Progress to stderr — stdout is reserved for the JSON result line."""
    print(f"[compose_spec] {message}", file=sys.stderr)


# --- Config -------------------------------------------------------------------
def _data_root() -> Path:
    """AETHER_DATA_DIR → RAVEN_USER_DIR → ~/.raven (draft_lane_tool parity)."""
    base = os.environ.get("AETHER_DATA_DIR") or os.environ.get("RAVEN_USER_DIR")
    return Path(base) if base else Path.home() / ".raven"


def resolve_model() -> str:
    """The Director-configured draft model. No default lives in this file —
    'model choice is config, never hardcoded' (#312 item 1) means an
    unconfigured model is an instructive error, not a silent fallback."""
    env_model = os.environ.get(MODEL_ENV, "").strip()
    if env_model:
        return env_model
    config_path = _data_root().joinpath(*CONFIG_SUBPATH)
    if config_path.is_file():
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
        except (ValueError, OSError) as e:
            raise ComposeError(f"could not read {config_path}: {e}") from e
        model = config.get(CONFIG_KEY) if isinstance(config, dict) else None
        if isinstance(model, str) and model.strip():
            return model.strip()
    raise ComposeError(
        f"no draft model configured — set {MODEL_ENV} in env, or write "
        f'{{ "{CONFIG_KEY}": "<model-id>" }} to {config_path}. '
        "The model is the Director's choice; this script ships no default."
    )


# --- GitHub REST ---------------------------------------------------------------
# Repo resolution parity with nodes/github/src/index.ts (DEFAULT_REPO +
# REPO_SHAPE): env override wins, the canonical default otherwise, malformed
# is a loud refusal. Keep both sides in lockstep.
DEFAULT_REPO = "ashwinsreedhar28/Aether"
_REPO_SHAPE_RE = re.compile(r"^[\w.-]+/[\w.-]+$")


def _repo() -> str:
    repo = os.environ.get("AETHER_GITHUB_REPO", "").strip() or DEFAULT_REPO
    if not _REPO_SHAPE_RE.match(repo):
        raise ComposeError("AETHER_GITHUB_REPO must be owner/name")
    return repo


def _ssl_context() -> ssl.SSLContext:
    """certifi's CA bundle when available (it rides the venv via fastembed's
    transitive deps), else the system default. python.org macOS builds ship
    without system CAs wired up — without this, every REST hop fails
    CERTIFICATE_VERIFY_FAILED while Node's fetch (the github node) sails."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def _gh_request(method: str, path: str, body: dict[str, Any] | None = None) -> Any:
    """One REST call. The token travels ONLY in the Authorization header and
    never appears in errors or logs (the github.ts stance)."""
    token = os.environ.get("AETHER_GITHUB_TOKEN", "").strip()
    if not token:
        raise ComposeError("AETHER_GITHUB_TOKEN not set — issue read/write unavailable")
    request = urllib.request.Request(
        f"{API_ROOT}{path}",
        method=method,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers={
            "accept": "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "authorization": f"Bearer {token}",
            **({"content-type": "application/json"} if body is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(
            request, timeout=REQUEST_TIMEOUT_S, context=_ssl_context()
        ) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode("utf-8")).get("message", "")
        except Exception:
            pass
        raise ComposeError(f"github api {e.code} on {method} {path}: {detail or 'no detail'}") from None
    except urllib.error.URLError as e:
        raise ComposeError(f"github api unreachable: {e.reason}") from None


def fetch_issue(number: int) -> dict[str, Any]:
    """The issue plus one oldest-first comment page. Refuses PRs and closed
    issues (work_on_issue parity: a closed number is near-certainly a typo)."""
    repo = _repo()
    raw = _gh_request("GET", f"/repos/{repo}/issues/{number}")
    if raw.get("pull_request") is not None:
        raise ComposeError(f"#{number} is a pull request, not an issue")
    if raw.get("state") != "open":
        raise ComposeError(f"issue #{number} is closed")
    comments = _gh_request(
        "GET", f"/repos/{repo}/issues/{number}/comments?per_page={COMMENTS_LIMIT}"
    )
    return {
        "number": raw.get("number", number),
        "title": raw.get("title", ""),
        "body": raw.get("body") or "",
        "labels": [
            label.get("name", "") if isinstance(label, dict) else str(label)
            for label in raw.get("labels", [])
        ],
        "comments": [
            {"author": (c.get("user") or {}).get("login"), "body": c.get("body") or ""}
            for c in comments
            if isinstance(c, dict)
        ],
    }


def ratified_spec_present(issue: dict[str, Any]) -> bool:
    """True when the body or any comment already carries the real marker."""
    candidates = [issue.get("body") or ""]
    candidates.extend(c.get("body") or "" for c in issue.get("comments", []))
    return any(SPEC_GUARD_RE.search(text) for text in candidates)


# --- Retrieval -----------------------------------------------------------------
def rag_queries(issue: dict[str, Any]) -> list[str]:
    """Up to RAG_QUERIES_MAX queries from the gap record: the title (the
    'gap(<area>): <summary>' line is a strong semantic query as-is), the
    verbatim utterance (first blockquoted body line — buildGapBody's shape),
    and the failure line when it says more than '—'."""
    queries: list[str] = []
    title = " ".join((issue.get("title") or "").split())
    if title:
        queries.append(title)
    body = issue.get("body") or ""
    utterance = re.search(r"^> (.+)$", body, re.MULTILINE)
    if utterance and utterance.group(1).strip() not in queries:
        queries.append(utterance.group(1).strip())
    failure = re.search(r"\*\*Attempted path / failure:\*\*\s*(.+)", body)
    if failure:
        detail = failure.group(1).strip()
        if detail and detail != "—" and detail not in queries:
            queries.append(detail)
    return queries[:RAG_QUERIES_MAX]


def retrieve_precedent(queries: list[str]) -> list[dict[str, Any]]:
    """KNN the local corpus via the sibling spike's rag_lib (the primitive
    search_corpus wraps). Missing index = instructive refusal naming
    reindex.sh (server.py parity); stale index = stderr warning, proceed."""
    if str(RAG_DIR) not in sys.path:
        sys.path.insert(0, str(RAG_DIR))
    import rag_lib  # lazy: fastembed/sqlite-vec live in this daemon's venv

    if not rag_lib.DB_PATH.exists():
        raise ComposeError(
            f"no search index at {rag_lib.rel(rag_lib.DB_PATH)} — build it with "
            "daemons/aether-rag/reindex.sh (this script never builds the index)"
        )
    staleness = rag_lib.index_staleness()
    if staleness.state == "stale":
        _log(
            "STALE INDEX — older than the corpus; precedent may miss recent "
            f"edits (newest: {staleness.newest_source}). Run reindex.sh."
        )
    best: dict[tuple[str, int], Any] = {}
    conn = rag_lib.open_db()
    try:
        for query in queries:
            for passage in rag_lib.search(conn, query, k=RAG_K_PER_QUERY):
                key = (passage.source, passage.start_line)
                if key not in best or passage.score > best[key].score:
                    best[key] = passage
    finally:
        conn.close()
    ranked = sorted(best.values(), key=lambda p: p.score, reverse=True)[:RAG_PASSAGES_MAX]
    _log(f"retrieved {len(ranked)} precedent passage(s) from {len(queries)} query(ies)")
    return [
        {
            "source": p.source,
            "lines": f"{p.start_line}-{p.end_line}",
            "anchor": p.anchor,
            "score": round(p.score, 3),
            "text": p.text[:PASSAGE_MAX],
        }
        for p in ranked
    ]


# --- The model call ------------------------------------------------------------
def build_prompt(issue: dict[str, Any], passages: list[dict[str, Any]]) -> str:
    """Deterministic prompt assembly (the _compose_lane_prompt stance: the
    fixed rails are code, only the judgment is the model's)."""
    number = issue["number"]
    lines: list[str] = [
        "You are the Architect for Aether, an always-on personal OS built by a",
        "Director (human) and Implementer lanes (Claude Code sessions). A GAP",
        "issue records something Aether could not do — it carries the moment of",
        "failure, never a spec. Your job: draft a CANDIDATE spec for this gap,",
        "grounded in the precedent passages from the project's own corpus.",
        "",
        "House spec format — exactly these sections, in this order:",
        "PROBLEM: <what is missing and why it matters, grounded in the record>",
        "FIX (skeleton): <numbered steps; name files/dirs precisely when the",
        "precedent names them; pre-decide only load-bearing choices and leave",
        "local ones to the implementer>",
        "SMOKE: <what the Director runs/says to confirm it works>",
        "OUT OF SCOPE: <the adjacent work this lane must not touch>",
        f"Then end with exactly: Full §7. Closes #{number}.",
        "",
        "Rules:",
        "- Plain markdown, no preamble before PROBLEM and nothing after the",
        "  closing line.",
        "- This is an UNRATIFIED draft for human review. Never open any line",
        "  with the all-caps ratification marker (the words ARCHITECT SPEC in",
        "  capitals at a line start) — write around it; a sanitizer will",
        "  blockquote any line that tries.",
        "- Prefer the smallest skeleton that closes the gap; cite precedent",
        "  sources (path:lines) inline where they shaped a step.",
        "",
        f"=== GAP ISSUE #{number}: {' '.join(issue['title'].split())} ===",
        f"labels: {', '.join(issue['labels']) or '(none)'}",
        "",
        issue["body"][:BODY_MAX],
    ]
    comments = issue.get("comments", [])[:COMMENTS_IN_PROMPT_MAX]
    if comments:
        lines.append("")
        lines.append(f"=== COMMENTS (oldest first, {len(comments)} shown) ===")
        for comment in comments:
            lines.append(f"--- {comment.get('author') or 'unknown'} ---")
            lines.append((comment.get("body") or "")[:COMMENT_MAX])
    lines.append("")
    lines.append("=== PRECEDENT (retrieved from the Aether corpus) ===")
    if passages:
        for i, p in enumerate(passages, 1):
            lines.append(f"[{i}] {p['source']}:{p['lines']}  ({p['anchor']}, score {p['score']})")
            lines.append(p["text"])
            lines.append("")
    else:
        lines.append("(no passages retrieved — draft from the record alone, and say so)")
    return "\n".join(lines)


def call_model(prompt: str, model: str) -> str:
    """One generate_content call against the configured model."""
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ComposeError("GEMINI_API_KEY not set — the draft model is unreachable")
    from google import genai  # lazy: keeps unit tests and compileall dep-free

    client = genai.Client(api_key=api_key)
    _log(f"composing draft with {model}…")
    try:
        response = client.models.generate_content(model=model, contents=prompt)
    except Exception as e:  # the SDK's error taxonomy is wide; name the model, not the key
        raise ComposeError(f"model call failed ({model}): {e}") from None
    text = (response.text or "").strip()
    if not text:
        raise ComposeError(f"model returned an empty draft ({model})")
    return text


# --- Guard interaction (#312 item 2) --------------------------------------------
def defang(draft: str) -> str:
    """Blockquote any line that would satisfy the line-anchored spec guard —
    the gap.ts idiom: the content survives for the human reader, the anchor
    breaks for the machine. Everything else passes through verbatim."""
    return "\n".join(
        f"> {line}" if SPEC_GUARD_RE.match(line) else line
        for line in draft.splitlines()
    )


def _assert_unguarded(body: str) -> None:
    """The hard floor under the sanitizer: a body that still matches the
    guard is never posted, whatever produced it."""
    if SPEC_GUARD_RE.search(body):
        raise GuardViolation(
            "composed comment matched the spec guard after sanitizing — "
            "refusing to post (machine drafts never self-certify)"
        )


def assemble_comment(number: int, title: str, draft: str, model: str) -> str:
    """The full comment body: the literal unratified prefix, the defanged
    draft, and a provenance footer. The footer names the marker only in
    lowercase prose (the gap.ts stance) so the body stays guard-clean."""
    one_line_title = " ".join((title or "").split()) or f"issue #{number}"
    body = "\n".join(
        [
            f"{DRAFT_PREFIX}{one_line_title}",
            "",
            defang(draft),
            "",
            "---",
            f"_Machine-composed (Rung 1.5) from the gap record + corpus precedent; model: {model}._",
            "_Unratified: this draft arms nothing. Ratification is a human re-posting the agreed",
            "content under the real all-caps architect spec marker._",
        ]
    )
    _assert_unguarded(body)
    return body


# --- Pipeline -------------------------------------------------------------------
def post_comment(number: int, body: str) -> dict[str, Any]:
    created = _gh_request("POST", f"/repos/{_repo()}/issues/{number}/comments", {"body": body})
    return {"comment_id": created.get("id"), "url": created.get("html_url")}


def compose(number: int, dry_run: bool = False) -> dict[str, Any]:
    model = resolve_model()  # fail before any network if unconfigured
    issue = fetch_issue(number)
    if ratified_spec_present(issue):
        raise ComposeError(
            f"issue #{number} already carries a ratified spec — a machine "
            "draft under it would only add noise; nothing posted"
        )
    passages = retrieve_precedent(rag_queries(issue))
    draft = call_model(build_prompt(issue, passages), model)
    body = assemble_comment(number, issue["title"], draft, model)
    if dry_run:
        _log("dry run — composed body follows on stderr, nothing posted")
        print(body, file=sys.stderr)
        return {"ok": True, "dry_run": True, "number": number, "model": model}
    posted = post_comment(number, body)
    _log(f"draft posted on #{number}: {posted['url']}")
    return {
        "ok": True,
        "number": number,
        "model": model,
        "comment_id": posted["comment_id"],
        "url": posted["url"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Compose + post a machine-drafted, unratified candidate spec for a gap issue."
    )
    parser.add_argument("number", type=int, help="the gap issue number")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="compose and print the comment body to stderr without posting",
    )
    args = parser.parse_args(argv)
    try:
        result = compose(args.number, dry_run=args.dry_run)
    except ComposeError as e:
        # The JSON error line is the machine contract — the raven tool reads
        # it whether we exit 0 or 1.
        print(json.dumps({"ok": False, "error": str(e)}))
        return 1
    except Exception as e:
        # Unexpected failure (a dep, the index, the runtime): keep the
        # contract line on stdout for the voice path, full traceback on
        # stderr for the human. Never a bare traceback in place of JSON.
        import traceback

        traceback.print_exc()
        print(json.dumps({"ok": False, "error": f"unexpected: {type(e).__name__}: {e}"}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
