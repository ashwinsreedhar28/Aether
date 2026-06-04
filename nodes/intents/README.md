# intents

The mesh's **gap sensor**. Records the things Aether *cannot* do — requests
with no tool, no surface, or no data behind them — and serves them back. Gaps
have a **lifecycle**: recorded **open**, marked **closed** once the capability
they noted exists, so the ledger reflects what's been answered. First brick of
the self-building arc: Aether noticing its own gaps so they can later be turned
into capabilities — and noticing when they have been.

## Surfaces

- `intents.record` — persist one gap (recorded **open**).
  Params: `{ text: string, context?: string }`.
  Returns: `{ ok: true, id: string }`.
  Appends a record to the JSONL log and `fsync`s before returning.

- `intents.list` — recorded gaps, newest first.
  Params: `{ limit?: number (default 100, max 1000), status?: 'open' | 'closed' | 'all' (default 'open') }`.
  Returns: `{ gaps: GapRecord[], counts: { open, closed } }`.
  `status` filters the returned gaps; `counts` always reflects the whole log
  (uncapped, unfiltered) so a consumer showing only open gaps can still print
  "N open · M closed".

- `intents.close` — mark gap(s) closed.
  Params: `{ id?: string, match?: string }` — provide **one** selector. `id`
  closes that gap; `match` closes every OPEN gap whose `text` contains the
  case-insensitive substring (so "the email one is done" can close both mail
  gaps at once). `id` wins if both are passed. At least one is required
  (enforced in-node with `MeshDeny('intents_close_no_selector')`).
  Returns: `{ ok: true, count, closed: [{ id, text }] }`. A request matching no
  open gap is a no-op (`count: 0`).

A `GapRecord` is `{ id, ts, text, context, status }` — `id` is a UUID, `ts` an
ISO 8601 UTC timestamp, `text` the one-line gap description, `context` a string
or `null`, `status` `'open'` or `'closed'`.

## Storage

- Append-only JSONL at **`$AETHER_DATA_DIR/intents/gaps.jsonl`** — one gap per
  line. This follows the per-node storage convention every persistent node
  uses: `$AETHER_DATA_DIR/<node_id>/<file>` (cf.
  `clipboard_history/clipboard.db`, `news_feeds/news.db`). `$AETHER_DATA_DIR`
  is the shell's `userData/data` directory, handed to the node at spawn time —
  a standalone child process can't reach Electron's `app.getPath` itself.
- **Lifecycle (event-sourced):** the log holds two line shapes — a **gap** line
  `{ id, ts, text, context, status: 'open' }` and a **closure event**
  `{ id, ts, closed: true }`. `intents.close` appends a closure event; it never
  rewrites or truncates the file. Current state is derived by folding the log
  forward (oldest → newest): the gap line creates the record, a later closure
  event flips its status to `closed`. A closure for an unknown id is harmless.
  This keeps the lifecycle JSONL-honest — the same append-only durability that
  protects a recorded gap protects a closure.
- **Durability:** each append (`record()` and `close()`) opens the file `'a'`,
  writes the line(s), calls `fsyncSync`, then closes. The bytes are on stable
  storage before the response is sent, so a crash immediately afterward cannot
  lose the gap or the closure. The log survives shell restarts — read it back
  with `intents.list` or just `cat`.
- **Format choice:** JSONL, not SQLite. Gaps are low-frequency and append-only;
  the value of the first *mesh-authored* persistent store is that its on-disk
  state is trivially inspectable and trivially durable. Reach for a DB if/when a
  query pattern needs one — not before (CLAUDE.md §15: no premature
  abstraction).
- A malformed line (a partial write, a hand-edit) is skipped on read rather
  than failing the whole `list` — one bad line never blinds the log.

## Environment

- `MESH_INTENTS_SECRET` — required. Injected by the shell at startup.
- `MESH_CORE_URL` — defaults to `http://127.0.0.1:8000`.
- `AETHER_DATA_DIR` — required.

## Liveness

Writes a `running` marker file to the node directory after successful
registration with Core. Removed on graceful shutdown. Matches the
daemon-node liveness pattern; the gap log itself is the durable state.

## Category

Classified `Sensor` in `manifest.yaml`: like the other data nodes it holds a
queryable record and exposes it (`intents.list`). The twist is that its data
arrives by *push* (`intents.record`, invoked by raven) rather than by polling
the world — it senses Aether's own gaps instead of an external source. See the
PR that introduced this node for the Sensor-vs-Actor reasoning.
