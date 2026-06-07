#!/usr/bin/env python3
"""CLI: retrieve top passages from the aether-rag index for a question.

    python query.py "How do we resolve CHANGELOG conflicts?" -k 5

Scores are raw cosine similarity (1 - cosine distance), higher = closer.
They are reported verbatim — a weak match shows a low number rather than a
padded one, so a confident answer and a shrug look different.
"""
from __future__ import annotations

import argparse
import sys

import rag_lib


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("question", help="natural-language query")
    parser.add_argument("-k", type=int, default=5, help="number of passages (default 5)")
    args = parser.parse_args(argv)

    if not rag_lib.DB_PATH.exists():
        print(f"No index at {rag_lib.rel(rag_lib.DB_PATH)} — run ./reindex.sh first.", file=sys.stderr)
        return 1

    conn = rag_lib.open_db()
    passages = rag_lib.search(conn, args.question, k=args.k)
    print(rag_lib.format_results(args.question, passages))
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
