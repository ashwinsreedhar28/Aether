#!/usr/bin/env python3
"""Index Aether's own corpus into the sqlite-vec store.

Chunking is heading-aware:
  - Markdown is split at every H2/### and H3 boundary. Content before the
    first heading is an "(intro)" chunk. Each chunk carries a breadcrumb
    anchor (e.g. "Hard Gotchas > Electron / macOS") that is also prepended
    to the embedded text so retrieval keeps heading context even for the
    inner windows of a split section.
  - manifest.yaml is split per node (one chunk per `- id:` block under
    `nodes:`), plus a header chunk and a relationships chunk.
  - Oversize sections (> ~512 tokens) are windowed with overlap so the
    embedding model never silently truncates a long section.

Run directly (`python indexer.py`) for an in-place rebuild — the tables are
dropped and recreated each run, so it is idempotent on its own. reindex.sh
additionally deletes the DB file for a hard wipe.
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

import rag_lib

# --- Chunking parameters ----------------------------------------------------
TARGET_TOKENS = 512          # bge-small-en-v1.5 hard max; we chunk to fit
OVERLAP_TOKENS = 64          # carried between windows of an oversize section
WORDS_PER_TOKEN = 0.75       # rough English heuristic; no tokenizer dep needed
_BUDGET_WORDS = int(TARGET_TOKENS * WORDS_PER_TOKEN)
_OVERLAP_WORDS = int(OVERLAP_TOKENS * WORDS_PER_TOKEN)

HEADING_RE = re.compile(r"^(#{1,3})\s+(.*\S)\s*$")
FENCE_RE = re.compile(r"^\s*```")
NODE_ID_RE = re.compile(r"^  - id:\s*(\S+)")


@dataclass
class Chunk:
    source: str
    anchor: str
    start_line: int  # 1-indexed, inclusive
    end_line: int    # 1-indexed, inclusive
    text: str        # raw section text, for display
    embed_text: str  # anchor breadcrumb + text, what we actually embed


def _est_words(text: str) -> int:
    return len(text.split())


def _windows(lines: list[str], abs_start_idx: int) -> list[tuple[int, int, str]]:
    """Split a list of lines into overlapping windows under the word budget.
    Returns (abs_start_idx, abs_end_idx, text) tuples with 0-indexed absolute
    line numbers. abs_start_idx is the file-line index of lines[0]."""
    indexed = list(enumerate(lines))  # (rel_idx, line)
    out: list[tuple[int, int, str]] = []
    cur: list[tuple[int, str]] = []
    cur_words = 0
    for rel_idx, line in indexed:
        w = len(line.split())
        if cur and cur_words + w > _BUDGET_WORDS:
            start = abs_start_idx + cur[0][0]
            end = abs_start_idx + cur[-1][0]
            out.append((start, end, "\n".join(l for _, l in cur)))
            # seed next window with an overlap tail of the current one
            overlap: list[tuple[int, str]] = []
            ow = 0
            for ridx, l in reversed(cur):
                overlap.insert(0, (ridx, l))
                ow += len(l.split())
                if ow >= _OVERLAP_WORDS:
                    break
            cur = overlap
            cur_words = sum(len(l.split()) for _, l in cur)
        cur.append((rel_idx, line))
        cur_words += w
    if cur:
        start = abs_start_idx + cur[0][0]
        end = abs_start_idx + cur[-1][0]
        out.append((start, end, "\n".join(l for _, l in cur)))
    return out


def _emit(source: str, anchor: str, abs_start_idx: int, seg_lines: list[str]) -> list[Chunk]:
    """Turn one logical section into one or more Chunks, windowing if oversize.
    Empty/whitespace-only sections are dropped."""
    text = "\n".join(seg_lines)
    if not text.strip():
        return []
    if _est_words(text) <= _BUDGET_WORDS:
        windows = [(abs_start_idx, abs_start_idx + len(seg_lines) - 1, text)]
    else:
        windows = _windows(seg_lines, abs_start_idx)
    chunks: list[Chunk] = []
    n = len(windows)
    for i, (s, e, wtext) in enumerate(windows, 1):
        if not wtext.strip():
            continue
        part_anchor = anchor if n == 1 else f"{anchor} (part {i}/{n})"
        chunks.append(
            Chunk(
                source=source,
                anchor=part_anchor,
                start_line=s + 1,
                end_line=e + 1,
                text=wtext,
                embed_text=f"{part_anchor}\n\n{wtext}",
            )
        )
    return chunks


def chunk_markdown(source: str, text: str) -> list[Chunk]:
    lines = text.splitlines()
    # Locate headings, ignoring those inside fenced code blocks.
    headings: list[tuple[int, int, str]] = []  # (line_idx, level, title)
    in_fence = False
    for i, line in enumerate(lines):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = HEADING_RE.match(line)
        if m:
            headings.append((i, len(m.group(1)), m.group(2).strip()))

    # Breadcrumb per heading line: H2 -> "H2"; H3 -> "H2 > H3".
    breadcrumb: dict[int, str] = {}
    h2 = None
    for i, lvl, title in headings:
        if lvl == 1:
            h2 = None
        elif lvl == 2:
            h2 = title
            breadcrumb[i] = title
        elif lvl == 3:
            breadcrumb[i] = f"{h2} > {title}" if h2 else title

    split_idxs = [i for i, lvl, _ in headings if lvl in (2, 3)]

    chunks: list[Chunk] = []
    # Preamble: everything before the first split point.
    first_split = split_idxs[0] if split_idxs else len(lines)
    if first_split > 0:
        intro_anchor = next((t for i, lvl, t in headings if lvl == 1 and i < first_split), "(intro)")
        chunks += _emit(source, intro_anchor, 0, lines[0:first_split])

    for j, b in enumerate(split_idxs):
        seg_end = split_idxs[j + 1] if j + 1 < len(split_idxs) else len(lines)
        chunks += _emit(source, breadcrumb.get(b, lines[b].lstrip("# ").strip()), b, lines[b:seg_end])
    return chunks


def chunk_manifest(source: str, text: str) -> list[Chunk]:
    lines = text.splitlines()
    nodes_idx = next((i for i, l in enumerate(lines) if l.rstrip() == "nodes:"), None)
    rel_idx = next((i for i, l in enumerate(lines) if l.rstrip() == "relationships:"), None)
    if nodes_idx is None:  # not the shape we expect — fall back to md chunker
        return chunk_markdown(source, text)

    chunks: list[Chunk] = []
    chunks += _emit(source, "manifest header", 0, lines[0:nodes_idx])

    node_starts = [i for i in range(nodes_idx + 1, rel_idx or len(lines)) if NODE_ID_RE.match(lines[i])]
    nodes_end = rel_idx if rel_idx is not None else len(lines)
    for k, start in enumerate(node_starts):
        end = node_starts[k + 1] if k + 1 < len(node_starts) else nodes_end
        node_id = NODE_ID_RE.match(lines[start]).group(1)
        chunks += _emit(source, f"node: {node_id}", start, lines[start:end])

    if rel_idx is not None:
        chunks += _emit(source, "relationships", rel_idx, lines[rel_idx:len(lines)])
    return chunks


def chunk_file(path: Path) -> list[Chunk]:
    source = rag_lib.rel(path)
    text = path.read_text(encoding="utf-8", errors="replace")
    if path.name == "manifest.yaml":
        return chunk_manifest(source, text)
    return chunk_markdown(source, text)


def build_index() -> None:
    files = rag_lib.corpus_files()
    if not files:
        print("No corpus files matched — nothing to index.", file=sys.stderr)
        sys.exit(1)

    rag_lib.RAG_DIR.mkdir(parents=True, exist_ok=True)
    conn = rag_lib.open_db()
    conn.execute("DROP TABLE IF EXISTS chunks")
    conn.execute("DROP TABLE IF EXISTS vec_chunks")
    conn.execute(
        """
        CREATE TABLE chunks (
            id INTEGER PRIMARY KEY,
            source TEXT NOT NULL,
            anchor TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            text TEXT NOT NULL
        )
        """
    )
    conn.execute(
        f"CREATE VIRTUAL TABLE vec_chunks USING vec0("
        f"embedding float[{rag_lib.EMBED_DIM}] distance_metric=cosine)"
    )

    # Chunk every file first so we can embed in one batch (fastembed is much
    # faster batched, and the model loads once).
    per_file: list[tuple[str, list[Chunk]]] = []
    all_chunks: list[Chunk] = []
    for path in files:
        cks = chunk_file(path)
        per_file.append((rag_lib.rel(path), cks))
        all_chunks.extend(cks)

    print(f"Embedding {len(all_chunks)} chunks from {len(files)} docs "
          f"with {rag_lib.MODEL_NAME} …", flush=True)
    vectors = rag_lib.embed_passages([c.embed_text for c in all_chunks])

    import sqlite_vec

    cur = conn.cursor()
    for chunk, vec in zip(all_chunks, vectors):
        cur.execute(
            "INSERT INTO chunks(source, anchor, start_line, end_line, text) "
            "VALUES(?, ?, ?, ?, ?)",
            (chunk.source, chunk.anchor, chunk.start_line, chunk.end_line, chunk.text),
        )
        conn.execute(
            "INSERT INTO vec_chunks(rowid, embedding) VALUES(?, ?)",
            (cur.lastrowid, sqlite_vec.serialize_float32(vec)),
        )
    conn.commit()

    # --- Summary ----------------------------------------------------------
    print(f"\nIndexed {len(all_chunks)} chunks from {len(files)} docs "
          f"→ {rag_lib.rel(rag_lib.DB_PATH)}")
    width = max(len(src) for src, _ in per_file)
    for src, cks in per_file:
        print(f"  {src:<{width}}  {len(cks):>3} chunks")
    conn.close()


if __name__ == "__main__":
    build_index()
