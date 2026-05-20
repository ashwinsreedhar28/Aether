# macos_messages

Mesh node that mirrors recent iMessage/SMS messages from the macOS
Messages app's `chat.db` (read-only) and exposes them on the Aether
mesh.

## Surfaces

- `macos_messages.recent` — most recent messages, newest first.
  Params: `{ limit?: number (default 50, max 500), since?: ISO 8601 string }`.
  Returns: `{ messages: MessageEntry[] }`.

## Capture

- Source: `~/Library/Messages/chat.db` opened **read-only**
  (`better-sqlite3` with `{ readonly: true, fileMustExist: true }` and
  `PRAGMA busy_timeout = 5000` to coexist with the Messages.app writer).
- Cadence: 30s (`POLL_INTERVAL_MS` in `src/poller.ts`).
- Dedup: composite `UNIQUE(chat_id, message_id)` — chat.db ROWIDs are
  the source of truth, an INSERT OR IGNORE collapses repeated reads.
- Per-chat watermark on the **effective message time**
  `MAX(chat.db.message.date, chat.db.message.date_delivered)` (Mac
  Absolute Time). chat.db's raw `date_delivered` is 0 for messages sent
  *from* this Mac (Apple only populates the field on inbound APNS
  delivery), so the scalar max lets self-sent messages cross the
  watermark via `m.date` while inbound messages keep using `m.date_delivered`.
  The `date_delivered` field on `macos_messages.recent` rows stores
  this effective timestamp (the column name is preserved for
  consumer compatibility; see `storage.ts` for the semantic-drift
  note). Each poll cycle iterates chats, queries only rows newer
  than the watermark, and advances the watermark in the same
  transaction.
- Cold-start: the first tick is dropped to avoid bulk-importing the
  entire chat history when the node first runs (watermarks are still
  initialised so the second tick captures only genuinely new traffic).
- Apple Mac Absolute Time conversion:
  `unix_seconds = (apple_value / 1e9) + 978307200`.

## TCC / permissions

`chat.db` lives under macOS's TCC-protected `~/Library/Messages/`
sandbox; reading it requires **Full Disk Access** for the host process.
On `EACCES` the node logs a one-time warning and returns empty results
gracefully — it does NOT crash the daemon. The user-facing permission
prompt is deferred to a later lane.

## Storage

- Per-node SQLite at `$AETHER_DATA_DIR/macos_messages/messages.db`.
- WAL mode, NORMAL synchronous.
- Schema v1:
  - `messages_recent(id, chat_id, message_id, sender_handle,
    chat_identifier, chat_display_name, text, date_delivered,
    is_from_me, service, captured_at)` with
    `UNIQUE(chat_id, message_id)` and `INDEX idx_messages_date
    (date_delivered DESC)`.
  - `messages_watermarks(chat_id PRIMARY KEY, last_fetched_at)` —
    per-chat high-water mark in Mac Absolute Time.

## Environment

- `MESH_MACOS_MESSAGES_SECRET` — required. Injected by the shell at startup.
- `MESH_CORE_URL` — defaults to `http://127.0.0.1:8000`.
- `AETHER_DATA_DIR` — required.

## Liveness

Writes a `running` marker file to the node directory after successful
registration with Core. Removed on graceful shutdown.

## Known follow-ups

- chat.db schema is undocumented and ships with macOS. Queries are
  pinned to the columns we use today; schema drift across future macOS
  versions is a real risk and will need a compatibility shim.
- Attachments, reactions/tapbacks, edited-message tombstones, and
  group-chat membership are out of scope for this lane.
