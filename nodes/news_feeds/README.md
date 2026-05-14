# news_feeds

Mesh node that polls a hardcoded list of RSS/Atom feeds and exposes a single
`recent` surface returning ordered articles. First *data* node on the Aether
mesh — host_notifications was the first *action* node.

## Surface

`news_feeds.recent` — `request_response` — JSON Schema at
[`schemas/recent.json`](schemas/recent.json).

**Input**

```json
{ "limit": 20, "since": "2026-05-13T00:00:00Z" }
```

Both fields optional. `limit` defaults to 20, clamps to `[1, 100]`. `since`
is an ISO 8601 datetime; malformed strings return `MeshDeny:
news_feeds_bad_since`.

**Output**

```json
{
  "articles": [
    {
      "id": "ab12cd34ef567890",
      "feed": "BBC News",
      "title": "...",
      "summary": "...",
      "url": "https://...",
      "published_at": "2026-05-13T14:23:00Z",
      "fetched_at": "2026-05-13T14:30:01Z"
    }
  ]
}
```

`articles` is sorted by `published_at` desc, capped at `limit`. Empty on
first launch until the first poll completes (~5s after node start).

## Storage

SQLite via `better-sqlite3`. Path: `$AETHER_DATA_DIR/news_feeds/news.db`.
WAL mode; `synchronous=NORMAL`. A single table `articles` keyed on
deterministic id (sha1 of `feed::guid` truncated to 16 hex). Upserts on
poll dedupe re-emitted articles by id.

## Polling

15-minute interval, with an immediate first poll on startup so the node
has data within seconds rather than minutes. Each poll runs all feeds
through `Promise.allSettled` — one feed failing (timeout, malformed XML,
DNS) does not kill the others.

## Adding feeds

Edit [`src/feeds.ts`](src/feeds.ts) and rebuild. The list is hardcoded for
v1 — OPML import and per-user subscriptions are deferred (see
`DECISIONS.md`, "First real data node: news_feeds").

## Lifecycle markers

On successful Core registration, the node writes
`$AETHER_DATA_DIR/news_feeds/running` containing its PID and registration
timestamp. The shell's `nodeManager` removes its own PID file at
[`$userData/mesh/news_feeds.pid`]; the `running` marker is the node's
own liveness signal and is unlinked on graceful shutdown.

## Required env

| Var | Source | Notes |
|---|---|---|
| `MESH_NEWS_FEEDS_SECRET` | shell secrets bag | hex-32 per cold start |
| `MESH_CORE_URL` | shell coreManager | defaults to `http://127.0.0.1:8000` |
| `AETHER_DATA_DIR` | shell nodeManager | typically `app.getPath('userData')` |

The node refuses to start without `MESH_NEWS_FEEDS_SECRET` or
`AETHER_DATA_DIR`. `MESH_CORE_URL` falls back to localhost for convenience
when running the node by hand outside the shell.
