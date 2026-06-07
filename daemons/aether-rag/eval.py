#!/usr/bin/env python3
"""Run the six canned gate questions against the index and print each query
with its retrieved passages. No auto-grading — judgment is human (Director +
Architect read the output and decide whether retrieval quality clears the bar).

Q1–Q5 should surface the obviously-correct section near the top. Q6 is a
negative probe: Aether has no Kubernetes strategy, so honest behaviour is low
scores / weak passages, NOT a confident-looking wrong answer.
"""
from __future__ import annotations

import sys

import rag_lib

GATE_QUESTIONS: list[tuple[str, str]] = [
    ("Q1", "How do we resolve CHANGELOG conflicts when rebasing parallel lanes?"),
    ("Q2", "What was the decision on reading email bodies vs opening the message?"),
    ("Q3", "What does a lane do when verification is environmentally blocked?"),
    ("Q4", "What is the RECON-FIRST guardrail and why does it exist?"),
    ("Q5", "What must accompany a new node surface in the manifest?"),
    ("Q6", "What is our Kubernetes deployment strategy?"),
]

NEGATIVE_PROBES = {"Q6"}


def main() -> int:
    if not rag_lib.DB_PATH.exists():
        print(f"No index at {rag_lib.rel(rag_lib.DB_PATH)} — run ./reindex.sh first.", file=sys.stderr)
        return 1

    conn = rag_lib.open_db()
    print(f"Eval over {rag_lib.rel(rag_lib.DB_PATH)} — {len(GATE_QUESTIONS)} gate questions, k=5\n")
    print("=" * 78)
    for tag, question in GATE_QUESTIONS:
        note = "  (negative probe — expect weak/low scores)" if tag in NEGATIVE_PROBES else ""
        print(f"\n{tag}{note}")
        passages = rag_lib.search(conn, question, k=5)
        print(rag_lib.format_results(question, passages))
        print("\n" + "=" * 78)
    conn.close()
    print("\nNo auto-grading. Read the passages above and judge retrieval quality.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
