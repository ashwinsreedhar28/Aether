#!/usr/bin/env python3
"""Stdio MCP server exposing Aether's retrieval core as a tool.

This is the thin MCP wrapper over the proven aether-rag spike. It does NOT
reimplement retrieval — it imports `rag_lib` (the same module `query.py` and
`eval.py` sit on) and calls `rag_lib.search`. The corpus, chunking, embedding
model, and KNN store all live in the spike; this file only adapts that one
primitive to the Model Context Protocol so every Claude Code session in this
repo inherits it as a tool (see repo-root `.mcp.json`).

Surface: ONE read-only tool, `search_corpus`. There is deliberately no reindex
tool and no write surface — building the index stays a human-run script
(`reindex.sh`). A read-only server cannot mutate the corpus or its index by
design.

Startup is predictable: importing this module loads no embedding model and
opens no database. The model and DB are touched lazily on the first
`search_corpus` call. If the index is missing the server still starts cleanly;
the tool call returns an instructive error naming `reindex.sh` rather than
silently building an index on first use (no magic).
"""
from __future__ import annotations

import contextlib
import sys
from pathlib import Path

# server.py lives beside rag_lib.py; make the import work regardless of the
# cwd Claude Code launches us from.
HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import rag_lib  # noqa: E402  (sys.path shim must run first)

from mcp.server.fastmcp import FastMCP  # noqa: E402
from mcp.types import ToolAnnotations  # noqa: E402

mcp = FastMCP(
    "aether-rag",
    instructions=(
        "Semantic search over Aether's own corpus — DECISIONS.md, CHANGELOG.md, "
        "CLAUDE.md, docs/governance-log.md, the scene protocol, per-release "
        "narratives, per-node READMEs, and manifest.yaml (chunked per node). "
        "Use search_corpus to ground answers about Aether's architecture, "
        "decisions, gotchas, and history in the actual repo docs instead of "
        "guessing or re-reading whole files."
    ),
)


@contextlib.contextmanager
def _stdout_to_stderr():
    """Protect the stdio JSON-RPC channel: any chatter a dependency prints to
    stdout during embedding/search would corrupt the protocol, so point Python
    stdout at stderr for the duration of the rag_lib call."""
    saved = sys.stdout
    sys.stdout = sys.stderr
    try:
        yield
    finally:
        sys.stdout = saved


def _missing_index_message() -> str:
    db = rag_lib.rel(rag_lib.DB_PATH)
    return (
        f"No search index found at {db}. The aether-rag corpus has not been "
        f"indexed yet (or the index was wiped). Build it with the human-run "
        f"reindex script:\n\n"
        f"    daemons/aether-rag/reindex.sh\n\n"
        f"If the venv is missing, create it first:\n"
        f"    cd daemons/aether-rag && python3 -m venv .venv && "
        f".venv/bin/pip install -r requirements.txt\n\n"
        f"This server is read-only and never builds the index itself — "
        f"reindexing stays a deliberate, human-run step."
    )


def _format(query: str, k: int, source_filter: str | None, passages: list) -> str:
    head = f"query: {query!r}  (k={k}"
    if source_filter:
        head += f", source_filter={source_filter!r}"
    head += f")\nmatches: {len(passages)}"
    if not passages:
        if source_filter:
            return (
                head
                + f"\n\nNo passages matched. The source_filter "
                f"{source_filter!r} may have excluded every candidate — it is a "
                f"case-insensitive substring match on the repo-relative source "
                f"path (e.g. 'DECISIONS', 'nodes/', 'governance-log'). Retry "
                f"without a filter to see what the corpus actually holds."
            )
        return head + "\n\nNo passages — the index may be empty; try ./reindex.sh."

    blocks = [head]
    for i, p in enumerate(passages, 1):
        loc = f"{p.source}:{p.start_line}-{p.end_line}"
        blocks.append(
            f"\n[{i}] score={p.score:.3f}  {loc}\n"
            f"    heading: {p.anchor}\n"
            f"{p.text}"
        )
    return "\n".join(blocks)


@mcp.tool(
    annotations=ToolAnnotations(
        title="Search Aether corpus",
        readOnlyHint=True,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=False,
    ),
)
def search_corpus(
    query: str,
    k: int = 5,
    source_filter: str | None = None,
) -> str:
    """Semantic search over Aether's own documentation corpus.

    Returns up to `k` passages ranked by cosine similarity (reported verbatim:
    higher is closer, a weak match shows a low number, not a padded one). Each
    passage gives its score, source path with line span (source:start-end), the
    heading breadcrumb, and the passage text — so every result is traceable
    back to the exact section of the exact file.

    Args:
        query: Natural-language question (e.g. "How do we resolve CHANGELOG
            conflicts?"). bge applies the query instruction prefix internally.
        k: Number of passages to return (default 5).
        source_filter: Optional case-insensitive substring matched against each
            passage's repo-relative source path. Use it to scope results to one
            file or tree — "DECISIONS" for DECISIONS.md, "nodes/" for per-node
            READMEs, "governance-log" for the gotchas log. Omit to search the
            whole corpus. When set, the filter is applied over the full ranked
            candidate set, so you still get the top-k *matching* passages.

    Raises:
        RuntimeError: if the index has not been built. The message names
            reindex.sh; this server never builds the index itself.
    """
    if k < 1:
        raise ValueError("k must be >= 1")
    if not rag_lib.DB_PATH.exists():
        raise RuntimeError(_missing_index_message())

    conn = rag_lib.open_db()
    try:
        with _stdout_to_stderr():
            if source_filter:
                # Wrap, don't reimplement: over-fetch the full ranked candidate
                # set (KNN over every chunk), then substring-filter on source and
                # truncate to k. For this corpus (hundreds of chunks) ranking all
                # of them is cheap and guarantees the filter never misses a
                # relevant passage that fell outside a small top-k window.
                total = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
                candidates = rag_lib.search(conn, query, k=max(total, 1))
                needle = source_filter.lower()
                passages = [p for p in candidates if needle in p.source.lower()][:k]
            else:
                passages = rag_lib.search(conn, query, k=k)
    finally:
        conn.close()

    return _format(query, k, source_filter, passages)


if __name__ == "__main__":
    mcp.run(transport="stdio")
