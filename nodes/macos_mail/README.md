# macos_mail

Mesh node that mirrors recent inbox messages from macOS Mail.app and exposes
them on the Aether mesh — and opens a message on demand.

## Surfaces

- `macos_mail.recent` — most recent inbox messages, newest first.
  Params: `{ limit?: number (default 50, max 500), since?: ISO 8601 string,
  unread_only?: boolean (default false) }`.
  Returns: `{ messages: MailEntry[] }`, where each entry is
  `{ id, uid, sender, subject, dateReceived, readStatus, body, bodyTruncated }`.
  `body` is the plain-text message body — whitespace-normalized and capped
  (see Capture → Bodies). It is `null` for any message outside the recent
  body window not yet backfilled, one written off after repeated read
  failures, or one whose body is genuinely empty/unreadable. `bodyTruncated`
  is `1` when the stored body was truncated, `0` otherwise.
- `macos_mail.open_message` — **actor** surface; pulls a message up in
  Mail.app. Params: `{ id: string }` — the RFC Message-ID (the `uid` from
  `recent`). Returns: `{ opened: true, id }`. Opens via `open
  "message://%3c<id>%3e"` (LaunchServices), **not** AppleScript — so it stays
  responsive even when Mail's scripting interface is degraded (the latency that
  throttles the poller). Needs no Automation permission. macOS-only (non-darwin
  returns a `MeshDeny`); a malformed/empty id or a failed `open` also denies.
  This is the headline path: "read / show / open / pull up my latest email"
  speaks one summary line and opens the message rather than narrating the body.

## Capture

- Mail.app latency reality: Mail.app's response to AppleScript is **highly
  variable** — sub-second when the app is idle, but tens of seconds (measured
  up to 120s for a single property read) when it is busy syncing/indexing a
  large store (here ~5 GB). Every query design below is shaped by this: the
  bottleneck is per-Apple-Event latency, not message size. When Mail is in a
  degraded burst, reads time out and the poll is skipped; the node retries the
  next tick and writes the failure to `mail_meta` (see Observability) so the
  stall is visible, not silent.
- Headers (bulk reads): the header poll (`MAIL_RECENT_INBOX_QUERY` in
  `src/queries.ts`) emits up to 20 entries per call as tab-separated values,
  one record per line:
  `<message id>\t<subject>\t<sender>\t<ISO date>\t<read flag 0|1>`.
  It reads each property of the **whole range in one Apple Event**
  (`message id of messages 1 thru 20 of inbox`, then `subject of …`, etc.) —
  ~6 events total, not the ~100 a per-message `repeat` loop would issue. This
  is the load-bearing robustness choice: under moderate Mail latency a
  100-event loop blows the 30s bridge timeout and starves everything
  downstream, whereas ~6 events stay under it. (Properties are requested
  directly on the range, not via an intermediate `set msgList to …`, which
  would hand back message-id-keyed references that fail `-1728` on a
  subsequent `message id of`.) The ISO date coercion (`«class isot»`) runs in
  a local loop inside the `tell` and issues no events.
- Bodies: a message's plain-text body (`content of msg`) is **decoupled**
  from the header poll because `content` is slow and unbatchable under Mail
  latency (measured ~31–45s for one message). Each tick fetches **one** body
  via a separate bridge call (`buildSingleBodyQuery(position)`,
  `PER_BODY_TIMEOUT_MS` = 50s) for the newest message in the body window
  (`BODY_WINDOW` = 3) that still lacks one — newest first, so the window fills
  over a few ticks and "read me my latest email" works first. A separate call
  per message isolates faults: a slow/unreadable message can't take its
  siblings down with it.
  The body read is wrapped in a nested AppleScript `try`, so an unreadable
  body yields an empty body (→ `body: null`) without losing the message id.
  Capping is two-stage: a coarse 4000-char **source cap** in AppleScript
  (`text 1 thru 4000`) bounds transfer, then a **final ~1500-char cap**
  (`FINAL_BODY_CAP`) after the poller collapses whitespace runs; these are
  spoken aloud by RAVEN, so the cap keeps a single read sane. `bodyTruncated
  = 1` whenever either cap fired. Tabs and every newline variant are folded
  to spaces (AppleScript `foldWhitespace` + a poller-side flatten) so a
  multi-line body stays a single TSV field.
- Retry cap & visibility: a message that fails (bridge timeout/error) or
  returns no readable body increments a per-message `body_attempts` counter;
  after `MAX_BODY_ATTEMPTS` (3) it's left alone, so a permanently-unreadable
  top-of-inbox message doesn't burn AppleScript time every tick. Body-fetch
  failures increment a consecutive-failure counter that is **logged** (with
  the count and per-message attempt) — graceful degradation never silently
  hides a systemic body-capture break; recovery is logged too.
- Cadence: 60s (`POLL_INTERVAL_MS` in `src/poller.ts`). The header poll is
  fast; one body fetch (≤50s) plus the header poll stays under the interval,
  and the re-entrance guard backstops a rare overrun. The body pass is
  skipped entirely once the window is filled (or written off).
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
- Schema v3:
  - `mail_messages(id, uid UNIQUE, sender, subject, date_received,
    read_status, captured_at, body, body_truncated, body_attempts)` with
    `INDEX idx_mail_date_received (date_received DESC)`.
  - v2 added `body TEXT` (nullable) and `body_truncated INTEGER NOT NULL
    DEFAULT 0`; v3 added `body_attempts INTEGER NOT NULL DEFAULT 0` (the
    per-message body-fetch retry counter). All via `ALTER TABLE`; migration
    is idempotent via `PRAGMA user_version`.
  - Headers insert with `body = NULL`; the poller **backfills** bodies for
    the newest few messages over subsequent ticks (`UPDATE … WHERE body IS
    NULL`), so the inbox already on disk becomes readable without waiting for
    new mail. A row stays `body = NULL` if it's outside the body window, was
    written off after `body_attempts` hit the cap, or its body is genuinely
    empty/unreadable.

## Observability

The node's stdout is not surfaced anywhere a developer watches in the running
shell, so poll/capture health is also written to a `mail_meta(key, value)`
table in the same SQLite DB. Inspect it with:

```
sqlite3 "$AETHER_DATA_DIR/macos_mail/mail.db" "SELECT * FROM mail_meta;"
```

Keys written by the poller each tick:
- `last_header_at` / `last_header_status` — ISO time and outcome of the most
  recent header poll (`ok`, `timeout`, `permission_denied`, `syntax`,
  `unknown`); `last_header_error` carries the message on failure.
- `last_body_at` / `last_body_status` — most recent body fetch and its outcome
  (`ok`, `empty_body`, `idle_window_filled`, or a bridge error like
  `timeout`); `last_body_error` carries the message on failure.
- `body_fetch_failures` — consecutive body-fetch failures (resets to `0` on
  the next success).
- `last_backfill_at` — ISO time a body was last written.

This exists because a silent `47|0|0` (47 rows, no bodies) was indistinguish-
able between "never attempted" and "failing"; `last_header_status = timeout`
in `mail_meta` names the cause at a glance (Mail latency starving the poll).

## Environment

- `MESH_MACOS_MAIL_SECRET` — required. Injected by the shell at startup.
- `MESH_CORE_URL` — defaults to `http://127.0.0.1:8000`.
- `AETHER_DATA_DIR` — required.

## Liveness

Writes a `running` marker file to the node directory after successful
registration with Core. Removed on graceful shutdown.

## Known follow-ups

- Only the newest `BODY_WINDOW` (3) messages get bodies, and the fixed
  ~28s-per-invocation `content` overhead means each body costs a full bridge
  call. Widening the window or speeding capture would need either a faster
  plain-text accessor than `content of msg` (none found) or a persistent
  AppleScript/JXA helper that amortizes the per-invocation warmup across
  many reads. `on-demand at the surface` (fetch the body live for a
  small-limit `recent` call) was considered and deferred.
- Mailbox scope is `inbox` only. Multi-account / multi-mailbox capture
  is a follow-up — the AppleScript model already supports it.
- Attachments, threading, and flags beyond read/unread are out of scope
  for this lane.
