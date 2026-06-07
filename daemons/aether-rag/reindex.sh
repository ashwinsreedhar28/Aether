#!/usr/bin/env bash
# Wipe and rebuild the aether-rag index. Idempotent — safe to run repeatedly.
#
# Hard wipe: deletes the DB file (the indexer also drops/recreates its tables,
# but removing the file clears any stale schema or sqlite-vec shadow tables too).
set -euo pipefail

cd "$(dirname "$0")"

VENV_PY=".venv/bin/python"
if [[ ! -x "$VENV_PY" ]]; then
  echo "No venv at .venv/ — create it first:" >&2
  echo "  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

echo "Wiping .rag/index.db …"
rm -f .rag/index.db .rag/index.db-journal .rag/index.db-wal .rag/index.db-shm

echo "Rebuilding index …"
"$VENV_PY" indexer.py
