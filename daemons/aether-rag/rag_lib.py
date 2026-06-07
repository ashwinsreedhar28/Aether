"""Shared plumbing for the aether-rag spike: paths, corpus globs, the
embedding model, the sqlite-vec store, and the search primitive.

Standalone — imports nothing from repo code, knows nothing about the mesh
or MCP. The three entry points (indexer.py, query.py, eval.py) all sit on
top of this module so DB-open and model-load logic lives in one place.

Model: BAAI/bge-small-en-v1.5 via fastembed (ONNX, no torch), 384-dim.
bge models are asymmetric — passages embed bare, queries get an instruction
prefix. fastembed exposes that split as .embed() vs .query_embed(); we use
both so retrieval quality reflects the model's intended usage.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterable, NamedTuple

# fastembed + sqlite_vec are imported lazily inside the functions that need
# them so that `python -m compileall` and `--help` stay fast and don't pay
# the model-import cost.

# --- Paths ------------------------------------------------------------------
# This file lives at daemons/aether-rag/rag_lib.py; the repo root is two
# directories up (aether-rag -> daemons -> <repo root>).
HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
RAG_DIR = HERE / ".rag"
DB_PATH = RAG_DIR / "index.db"

MODEL_NAME = "BAAI/bge-small-en-v1.5"
EMBED_DIM = 384  # bge-small-en-v1.5 output dimension

# --- Corpus -----------------------------------------------------------------
# Globs are relative to REPO_ROOT. Order is cosmetic; the indexer dedupes by
# resolved path so overlapping globs are harmless.
CORPUS_GLOBS: tuple[str, ...] = (
    "docs/governance-log.md",
    "docs/rebase-playbook.md",
    "DECISIONS.md",
    "CHANGELOG.md",
    "CLAUDE.md",
    "docs/scene-protocol.md",
    "docs/releases/*.md",
    "docs/README.md",
    "README.md",
    "nodes/*/README.md",
    "manifest.yaml",
)


def corpus_files() -> list[Path]:
    """Resolve CORPUS_GLOBS against REPO_ROOT into a deduped, sorted list of
    existing files."""
    seen: dict[Path, None] = {}
    for pattern in CORPUS_GLOBS:
        for path in sorted(REPO_ROOT.glob(pattern)):
            if path.is_file():
                seen.setdefault(path.resolve(), None)
    return list(seen.keys())


def rel(path: Path) -> str:
    """Repo-root-relative POSIX path for display/storage."""
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


# --- Embedding model --------------------------------------------------------
_MODEL = None


def get_model():
    """Load (and cache for the process) the fastembed model. First call in a
    fresh environment downloads the ONNX weights into the fastembed cache."""
    global _MODEL
    if _MODEL is None:
        from fastembed import TextEmbedding

        _MODEL = TextEmbedding(model_name=MODEL_NAME)
    return _MODEL


def embed_passages(texts: list[str]) -> list[list[float]]:
    """Embed corpus passages (no query instruction prefix)."""
    model = get_model()
    return [vec.tolist() for vec in model.embed(texts)]


def embed_query(text: str) -> list[float]:
    """Embed a search query (bge instruction prefix applied by fastembed)."""
    model = get_model()
    return list(next(iter(model.query_embed([text]))).tolist())


# --- Store ------------------------------------------------------------------
def open_db(path: Path = DB_PATH) -> sqlite3.Connection:
    """Open the index DB with the sqlite-vec extension loaded."""
    import sqlite_vec

    conn = sqlite3.connect(path)
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    return conn


# --- Search -----------------------------------------------------------------
class Passage(NamedTuple):
    score: float  # cosine similarity in [0, 1]; higher is closer. Honest — no floor.
    source: str
    anchor: str
    start_line: int
    end_line: int
    text: str


def search(conn: sqlite3.Connection, query: str, k: int = 5) -> list[Passage]:
    """Embed `query`, KNN over the vec0 store, return up to k passages ordered
    by similarity. Reports cosine similarity (1 - cosine distance) verbatim;
    a weak match yields a low number rather than a padded one."""
    qvec = embed_query(query)
    import sqlite_vec

    # Run the KNN in a subquery first, then join metadata — the documented-safe
    # shape for sqlite-vec (a direct JOIN with the MATCH/k constraint trips up
    # some 0.1.x builds).
    rows = conn.execute(
        """
        SELECT c.source, c.anchor, c.start_line, c.end_line, c.text, v.distance
        FROM (
            SELECT rowid, distance
            FROM vec_chunks
            WHERE embedding MATCH ? AND k = ?
            ORDER BY distance
        ) AS v
        JOIN chunks c ON c.id = v.rowid
        ORDER BY v.distance
        """,
        (sqlite_vec.serialize_float32(qvec), k),
    ).fetchall()
    return [
        Passage(
            score=1.0 - float(distance),
            source=source,
            anchor=anchor,
            start_line=start_line,
            end_line=end_line,
            text=text,
        )
        for (source, anchor, start_line, end_line, text, distance) in rows
    ]


# --- Display ----------------------------------------------------------------
def format_results(query: str, passages: Iterable[Passage], snippet_chars: int = 320) -> str:
    """Human-readable block for one query and its passages."""
    out = [f"\n  query: {query!r}"]
    passages = list(passages)
    if not passages:
        out.append("    (no passages — empty index?)")
        return "\n".join(out)
    for i, p in enumerate(passages, 1):
        loc = f"{p.source}:{p.start_line}-{p.end_line}"
        snippet = " ".join(p.text.split())
        if len(snippet) > snippet_chars:
            snippet = snippet[:snippet_chars].rstrip() + "…"
        out.append(f"    [{i}] score={p.score:.3f}  {loc}")
        out.append(f"        ¶ {p.anchor}")
        out.append(f"        {snippet}")
    return "\n".join(out)
