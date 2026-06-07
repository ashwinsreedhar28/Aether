#!/usr/bin/env python3
"""Isolated check for rag_lib.index_staleness — the mtime-only freshness logic.

Stdlib only: it monkeypatches rag_lib's REPO_ROOT/DB_PATH onto a throwaway temp
tree and asserts the missing / stale / fresh verdicts. It never loads fastembed
or opens the sqlite-vec store (rag_lib imports those lazily), so it runs without
the venv:

    python3 daemons/aether-rag/test_staleness.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import rag_lib  # noqa: E402  (sys.path shim must run first)

T_OLD = 1_700_000_000
T_NEW = 1_800_000_000


def _write(root: Path, rel: str, mtime: int) -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(rel, encoding="utf-8")
    os.utime(path, (mtime, mtime))
    return path


class IndexStalenessTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        # Resolve up front so it matches corpus_files()' resolved paths — on
        # macOS /var/folders/... is a symlink to /private/var/folders/...,
        # which would otherwise break rel()'s relative_to(REPO_ROOT).
        self.root = Path(self._tmp.name).resolve()
        # Redirect rag_lib's repo root + index path onto the temp tree. Both are
        # module globals read at call time, so reassigning them reroutes
        # corpus_files() and DB_PATH.exists() without touching the real repo.
        self._saved_root = rag_lib.REPO_ROOT
        self._saved_db = rag_lib.DB_PATH
        rag_lib.REPO_ROOT = self.root
        rag_lib.DB_PATH = self.root / ".rag" / "index.db"

    def tearDown(self) -> None:
        rag_lib.REPO_ROOT = self._saved_root
        rag_lib.DB_PATH = self._saved_db
        self._tmp.cleanup()

    def test_missing_index(self) -> None:
        _write(self.root, "DECISIONS.md", T_NEW)
        s = rag_lib.index_staleness()
        self.assertEqual(s.state, "missing")
        self.assertIsNone(s.index_mtime)
        self.assertEqual(s.newest_source, "DECISIONS.md")

    def test_fresh_index(self) -> None:
        _write(self.root, "DECISIONS.md", T_OLD)
        _write(self.root, "docs/rebase-playbook.md", T_OLD)
        _write(self.root, ".rag/index.db", T_NEW)
        self.assertEqual(rag_lib.index_staleness().state, "fresh")

    def test_stale_index(self) -> None:
        _write(self.root, ".rag/index.db", T_OLD)
        # The smoke-test file: touching it must flip the verdict to stale.
        _write(self.root, "docs/rebase-playbook.md", T_NEW)
        s = rag_lib.index_staleness()
        self.assertEqual(s.state, "stale")
        self.assertEqual(s.newest_source, "docs/rebase-playbook.md")

    def test_equal_mtime_is_fresh(self) -> None:
        # reindex.sh writes the DB after the sources; equal mtime must not warn.
        _write(self.root, "CLAUDE.md", T_NEW)
        _write(self.root, ".rag/index.db", T_NEW)
        self.assertEqual(rag_lib.index_staleness().state, "fresh")

    def test_glob_sources_counted(self) -> None:
        # A glob-expanded source (nodes/*/README.md) is the newest corpus file.
        _write(self.root, "CLAUDE.md", T_OLD)
        _write(self.root, ".rag/index.db", T_OLD)
        _write(self.root, "nodes/weather/README.md", T_NEW)
        s = rag_lib.index_staleness()
        self.assertEqual(s.state, "stale")
        self.assertEqual(s.newest_source, "nodes/weather/README.md")


if __name__ == "__main__":
    unittest.main()
