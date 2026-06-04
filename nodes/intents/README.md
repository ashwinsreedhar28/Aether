# intents

The mesh's **gap sensor**. Records the things Aether *cannot* do — requests
with no tool, no surface, or no data behind them — and serves them back. First
brick of the self-building arc: Aether noticing its own gaps so they can later
be turned into capabilities.

## Surfaces

- `intents.record` — persist one gap.
  Params: `{ text: string, context?: string }`.
  Returns: `{ ok: true, id: string }`.
  Appends a record to the JSONL log and `fsync`s before returning.

- `intents.list` — recorded gaps, newest first.
  Params: `{ limit?: number (default 100, max 1000) }`.
  Returns: `{ gaps: GapRecord[] }`.

A `GapRecord` is `{ id, ts, text, context }` — `id` is a UUID, `ts` an ISO 8601
UTC timestamp, `text` the one-line gap description, `context` a string or
`null`.

## Storage

- Append-only JSONL at **`$AETHER_DATA_DIR/intents/gaps.jsonl`** — one gap per
  line. This follows the per-node storage convention every persistent node
  uses: `$AETHER_DATA_DIR/<node_id>/<file>` (cf.
  `clipboard_history/clipboard.db`, `news_feeds/news.db`). `$AETHER_DATA_DIR`
  is the shell's `userData/data` directory, handed to the node at spawn time —
  a standalone child process can't reach Electron's `app.getPath` itself.
- **Durability:** each `record()` opens the file `'a'`, writes the line, calls
  `fsyncSync`, then closes. The line is on stable storage before the `{ ok, id }`
  response is sent, so a crash immediately afterward cannot lose the gap. The
  log survives shell restarts — read it back with `intents.list` or just
  `cat`.
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
