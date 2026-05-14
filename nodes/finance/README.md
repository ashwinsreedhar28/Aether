# finance

Mesh node that polls stock quotes via Finnhub's `/quote` endpoint and
exposes two surfaces — `quote` for per-symbol lookups, `market_summary`
for the full tracked grid. Second *data* node on the homeOS mesh
(news_feeds was the first, host_notifications the first *action* node).

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

## Storage

In-memory `Map<symbol, CachedQuote>` — explicitly NOT SQLite. Stock
quotes are time-sensitive; persisting across restarts would surface
stale prices to consumers with no way to know they're stale. A cold
start re-polls from upstream and the renderer / voice get a brief empty
state until the first poll lands.

Cache freshness window: 5 minutes. `finance.quote` returns the cached
entry directly if it is fresh; otherwise it triggers an on-demand fetch
and updates the cache before returning. `finance.market_summary` always
reads the cache as-is (no on-demand refresh).

## Polling

5-minute cycle. Each cycle iterates the tracked list, fetching one
symbol every 30 seconds. With ten tickers the cycle takes exactly five
minutes, so cycles run back-to-back without idle gaps. Two requests
per minute averaged — well under Finnhub's free-tier 60-req/min
ceiling (no daily cap on the free tier). The stagger is kept rather
than burst-fetching, as belt-and-braces against future upstream-limit
tightening and to spread fetch latency across the cycle.

A 60-second cooldown is set whenever the upstream API returns HTTP 429.
During the cooldown the on-demand `finance.quote` fetch path returns
`MeshDeny: finance_rate_limited` rather than retrying immediately.

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

## What v1 does not include

- **Volume.** Finnhub's `/quote` endpoint does not return volume;
  fetching it requires a separate `/stock/metric` call that would
  double the request count against the rate limit for marginal user
  value. Re-add when there's a clear use case. See DECISIONS.md
  "Second data node: finance via Finnhub" for the trade-off.
- **Forex / crypto / commodities.** Stocks only.
- **Historical charts.** Day change only.
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
| `FINNHUB_API_KEY` | user-supplied | Free key at https://finnhub.io/register |
| `MESH_FINANCE_SECRET` | shell secrets bag | hex-32 per cold start |
| `MESH_CORE_URL` | shell coreManager | defaults to `http://127.0.0.1:8000` |
| `HOMEOS_DATA_DIR` | shell nodeManager | writable root for the liveness marker |

The node refuses to start without `FINNHUB_API_KEY`,
`MESH_FINANCE_SECRET`, or `HOMEOS_DATA_DIR`. `MESH_CORE_URL` falls back
to localhost for convenience when running the node by hand outside the
shell.
