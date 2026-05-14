# finance

Mesh node that polls stock quotes via Alpha Vantage's GLOBAL_QUOTE endpoint
and exposes two surfaces — `quote` for per-symbol lookups, `market_summary`
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
    "volume": 41203500,
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
minutes, so cycles run back-to-back without idle gaps. Two requests per
minute averaged — well under the historical 5-requests/minute rolling
rate limit, though the current Alpha Vantage free-tier daily cap (25
requests/day) is exceeded by this design. See `DECISIONS.md` for the
cap analysis and follow-up options.

A 60-second cooldown is set whenever the upstream API surfaces a
rate-limit response (HTTP 429 or the 200 + `Note`/`Information` shape
Alpha Vantage actually uses). During the cooldown the poller's
on-demand fetch path returns `MeshDeny: finance_rate_limited` rather
than retrying immediately.

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

## Lifecycle markers

On successful Core registration, the node writes
`$HOMEOS_DATA_DIR/finance/running` containing its PID and registration
timestamp — same convention as `news_feeds/running`. The marker is
unlinked on graceful shutdown.

## Required env

| Var | Source | Notes |
|---|---|---|
| `ALPHA_VANTAGE_API_KEY` | user-supplied | Free key at https://www.alphavantage.co/support/#api-key |
| `MESH_FINANCE_SECRET` | shell secrets bag | hex-32 per cold start |
| `MESH_CORE_URL` | shell coreManager | defaults to `http://127.0.0.1:8000` |
| `HOMEOS_DATA_DIR` | shell nodeManager | writable root for the liveness marker |

The node refuses to start without `ALPHA_VANTAGE_API_KEY`,
`MESH_FINANCE_SECRET`, or `HOMEOS_DATA_DIR`. `MESH_CORE_URL` falls back
to localhost for convenience when running the node by hand outside the
shell.
