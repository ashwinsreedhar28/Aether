# macos_mail

Mesh node that mirrors recent inbox messages from the macOS Mail.app and
exposes them on the Aether mesh.

## Surfaces

- `macos_mail.recent` — most recent inbox messages, newest first.
  Params: `{ limit?: number (default 50, max 500), since?: ISO 8601 string }`.
  Returns: `{ messages: MailEntry[] }`.

## Capture

- Source: Mail.app, queried via AppleScript through the
  `@aether/macos-applescript` bridge (`runAppleScript`). The inline
  script in `src/queries.ts` reads `messages 1 thru 20 of inbox` and
  emits up to 20 entries per call as tab-separated values, one record
  per line:
  `<message id>\t<subject>\t<sender>\t<ISO date>\t<read flag 0|1>`.
  Per-tick capture is scoped at the AppleScript layer to keep queries
  fast on large mailboxes — enumerating the full inbox exceeded the
  bridge's 30s timeout on a 97k-message account.
- Cadence: 60s (`POLL_INTERVAL_MS` in `src/poller.ts`). AppleScript is
  slow (typically 1–3s per call against a populated inbox), so the
  cadence is intentionally coarser than the chat.db poller's 30s.
- Dedup: `uid TEXT UNIQUE` on `mail_messages` — Mail.app's per-message
  `message id` is the source of truth. `INSERT OR IGNORE` collapses
  repeated reads.
- Cold-start: the first tick is dropped (mirrors the macos_messages
  pattern); the second tick captures the current top-20 inbox as the
  baseline. Practically this means the very first 20 messages observed
  after a fresh start populate at the second cycle, ~120s in.

## TCC / permissions

Reading Mail.app over AppleScript requires the host process to be
granted **Automation** access to Mail (System Settings → Privacy &
Security → Automation → <host app> → Mail). On the first invocation
macOS shows the consent dialog; on subsequent denials the bridge
returns `error: 'permission_denied'`. The poller logs a one-time warning
on `permission_denied` and stays up — a user grant takes effect at the
next tick without a restart. Same shape as `macos_messages`' EACCES
handling.

`timeout`, `syntax`, and `unknown` errors are logged and the cycle is
skipped — none of them crash the daemon.

## Storage

- Per-node SQLite at `$AETHER_DATA_DIR/macos_mail/mail.db`.
- WAL mode, NORMAL synchronous.
- Schema v1:
  - `mail_messages(id, uid UNIQUE, sender, subject, date_received,
    read_status, captured_at)` with
    `INDEX idx_mail_date_received (date_received DESC)`.

## Environment

- `MESH_MACOS_MAIL_SECRET` — required. Injected by the shell at startup.
- `MESH_CORE_URL` — defaults to `http://127.0.0.1:8000`.
- `AETHER_DATA_DIR` — required.

## Liveness

Writes a `running` marker file to the node directory after successful
registration with Core. Removed on graceful shutdown.

## Known follow-ups

- Bodies are NOT captured — only headers (subject, sender, date, read
  flag). Adding body capture is a separate lane; AppleScript can read
  body text but it's slow and large, and inbox-level metadata is enough
  for the first voice/digest use cases.
- Mailbox scope is `inbox` only. Multi-account / multi-mailbox capture
  is a follow-up — the AppleScript model already supports it.
- Attachments, threading, and flags beyond read/unread are out of scope
  for this lane.
