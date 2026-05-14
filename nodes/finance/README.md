# finance

Mesh node that polls US stock quotes — Yahoo Finance primary (via the
`yahoo-finance2` npm), Stooq CSV fallback when Yahoo flakes — and
exposes three surfaces: `quote` for per-symbol lookups,
`market_summary` for the full tracked grid, and `history` for the
accumulated time series of polled samples per symbol. No API key.
Second *data* node on the homeOS mesh (news_feeds was the first,
host_notifications the first *action* node).

## Surfaces

`finance.quote` — `request_response` — JSON Schema at
[`schemas/quote.json`](schemas/quote.json).

**Input**

```json
{ "symbol": "AAPL" }
```

`symbol` is required. Case-insensitive; normalised to uppercase. Must be
in the node's tracked list — symbols outside the list return
`MeshDeny: finance_untracked_symbol`.

**Output**

```json
{
  "quote": {
    "symbol": "AAPL",
    "price": 189.84,
    "change": 1.23,
    "change_percent": 0.6521,
    "volume": 40123456,
    "latest_trading_day": "2026-05-13",
    "fetched_at": "2026-05-13T17:23:01.482Z"
  }
}
```

`finance.market_summary` — `request_response` — JSON Schema at
[`schemas/market_summary.json`](schemas/market_summary.json). No
parameters.

**Output**

```json
{ "quotes": [ /* same Quote shape as above, one per cached symbol */ ] }
```

Empty array if the first poll has not yet populated the cache (handled
by the renderer's empty state).

`finance.history` — `request_response` — JSON Schema at
[`schemas/history.json`](schemas/history.json).

**Input**

```json
{ "symbol": "AAPL", "period": "1w" }
```

`symbol` is required; same tracked-list enforcement as `quote`.
`period` is optional and defaults to `"1w"`. Valid values: `"1d"`,
`"1w"`, `"1m"`, `"all"` (shortest → longest). Unknown values return
`MeshDeny: finance_bad_period`.

**Output**

```json
{
  "points": [
    {
      "fetched_at": "2026-05-13T17:23:01.482Z",
      "price": 189.84,
      "change_percent": 0.65
    }
  ]
}
```

Points are sorted oldest-first. Empty array on first-day installs (no
history accumulated yet) — not an error; the caller (voice tool or
sparkline) decides how to surface it.

## Storage

Two stores, by design:

**Current-quote cache.** In-memory `Map<symbol, CachedQuote>` —
explicitly NOT SQLite. Stock quotes are time-sensitive; persisting a
*current* price across restarts would surface stale data to consumers
with no way to know it's stale. A cold start re-polls and the
renderer / voice get a brief empty state until the first poll lands.
Cache freshness window: 5 minutes. `finance.quote` returns the cached
entry directly if it is fresh; otherwise it triggers an on-demand
fetch and updates the cache before returning. `finance.market_summary`
always reads the cache as-is (no on-demand refresh).

**Historical time series.** SQLite at
`$HOMEOS_DATA_DIR/finance/history.db` (WAL). Every successful poll
appends a row to `quotes_history (symbol, fetched_at, price, change,
change_percent)`, INSERT OR IGNORE on `(symbol, fetched_at)`. 90-day
rolling retention; older rows are pruned at the start of each poll
cycle. Persistence is honest here — every row carries its own
`fetched_at`, so consumers know exactly when each sample was
observed. The two stores together: the in-memory cache says "this is
the current price as of X minutes ago"; the SQLite series says "here
are the prices we observed at the following times." Different
questions, different storage.

Cold-start behaviour: no backfill from training data or an upstream
historical endpoint. First-day installs honestly return empty until
samples accumulate. See `DECISIONS.md` "Finance historical quotes via
passive accumulation" for the alternatives considered and rejected.

## Polling

5-minute cycle. Each cycle iterates the tracked list, fetching one
symbol every 30 seconds. With ten tickers the cycle takes exactly five
minutes, so cycles run back-to-back without idle gaps. Two requests
per minute averaged — comfortably below the "be polite to anonymous
endpoints" threshold for either provider.

Each fetch tries Yahoo Finance first. If Yahoo errors or returns
malformed data, the client falls back to Stooq's CSV endpoint
(`https://stooq.com/q/l/?s=<sym>.us&f=sd2t2ohlcv&h&e=csv`). A symbol
that both providers reject surfaces as `MeshDeny:
finance_unknown_symbol`; both providers erroring on a known symbol
surfaces as `MeshDeny: finance_provider_error`.

## Tracked symbols

Hardcoded in [`src/tickers.ts`](src/tickers.ts). Edit and rebuild to
change the set. User-configurable subscriptions are deferred to the
Settings app (future PR).

| Symbol | Name |
|---|---|
| AAPL | Apple |
| MSFT | Microsoft |
| GOOGL | Alphabet |
| AMZN | Amazon |
| NVDA | Nvidia |
| TSLA | Tesla |
| META | Meta |
| SPY | S&P 500 ETF |
| QQQ | Nasdaq 100 ETF |
| DIA | Dow Jones ETF |

## What this version does not include

- **Forex / crypto / commodities.** Stocks only.
- **Historical charts beyond the inline sparkline.** The 80×24
  in-card sparkline (last 24h) is the only chart UI shipped here; a
  detail view is a future PR if/when the user asks for it.
- **Historical backfill.** No upstream historical fetch and no
  training-data fill. History accumulates passively from polling.
- **Alerts.** No "notify me when AAPL hits 200" — composing this
  node's `quote` surface with `host_notifications.notify` is a future
  PR.

## Lifecycle markers

On successful Core registration, the node writes
`$HOMEOS_DATA_DIR/finance/running` containing its PID and registration
timestamp — same convention as `news_feeds/running`. The marker is
unlinked on graceful shutdown.

## Required env

| Var | Source | Notes |
|---|---|---|
| `MESH_FINANCE_SECRET` | shell secrets bag | hex-32 per cold start |
| `MESH_CORE_URL` | shell coreManager | defaults to `http://127.0.0.1:8000` |
| `HOMEOS_DATA_DIR` | shell nodeManager | writable root for the liveness marker |

The node refuses to start without `MESH_FINANCE_SECRET` or
`HOMEOS_DATA_DIR`. `MESH_CORE_URL` falls back to localhost for
convenience when running the node by hand outside the shell. No
upstream API key is required — Yahoo Finance and Stooq are both
anonymous endpoints.
