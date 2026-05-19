# clipboard_history

Mesh node that polls the macOS clipboard via `pbpaste` and exposes recent
entries on the Aether mesh.

## Surfaces

- `clipboard_history.recent` — most recent entries, newest first.
  Params: `{ limit?: number (default 50, max 500), since?: ISO 8601 string }`.
  Returns: `{ entries: ClipboardEntry[] }`.

## Capture

- Cadence: 500ms (`POLL_INTERVAL_MS` in `src/poller.ts`).
- Content types: `text/plain` only this lane. PNG / RTF / file refs deferred to Wave 3.
- Dedup: SHA-256 content hash. An in-memory ring buffer of the last 20
  hashes short-circuits the SQLite write for repeated reads of the same
  clipboard contents (the common case — users rarely re-copy).
- Cold-start: the first capture is dropped to avoid persisting whatever
  was on the user's clipboard when Aether started.
- Retention: 1000 most recent entries. Older rows pruned after each insert.

## Storage

- Per-node SQLite at `$AETHER_DATA_DIR/clipboard_history/clipboard.db`.
- WAL mode, NORMAL synchronous.
- Schema v1: single table `clipboard_entries(id, content_hash UNIQUE, content, content_type, captured_at)` with index on `captured_at DESC`.

## Environment

- `MESH_CLIPBOARD_HISTORY_SECRET` — required. Injected by the shell at startup.
- `MESH_CORE_URL` — defaults to `http://127.0.0.1:8000`.
- `AETHER_DATA_DIR` — required.

## Liveness

Writes a `running` marker file to the node directory after successful
registration with Core. Removed on graceful shutdown.
