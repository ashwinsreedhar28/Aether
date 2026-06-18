# finance

Mesh node that polls a ~95-symbol US-equity universe (a curated,
sector-tagged catalog in [`src/tickers.ts`](src/tickers.ts)) — Yahoo
Finance primary (via the `yahoo-finance2` npm), Stooq CSV fallback when
Yahoo flakes — and exposes nine surfaces: `quote` for per-symbol
lookups, `market_summary` for the full tracked grid (sector-enriched,
optional sector filter), `history` for the accumulated time series of
polled samples per symbol (sparkline), `chart` for a live upstream OHLC
series across fixed spans (the detail-page chart), `search` for catalog
lookup by symbol/name, plus the Sprint 2 surfaces `movers`, `sectors`,
`earnings`, and `market_overview` (documented under
[Sprint 2 surfaces](#sprint-2-surfaces)). No API key. Second *data* node
on the Aether mesh (news_feeds was the first, host_notifications the
first *action* node).

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
    "fetched_at": "2026-05-13T17:23:01.482Z",
    "name": "Apple",
    "sector": "Technology Hardware",
    "open": 188.6,
    "day_high": 190.2,
    "day_low": 187.9,
    "pe_ratio": 31.2,
    "market_cap": 2950000000000,
    "fifty_two_week_high": 199.6,
    "fifty_two_week_low": 164.1
  }
}
```

`name` + `sector` come from the catalog (the node stamps them);
`open`/`day_high`/`day_low`/`pe_ratio`/`market_cap`/`fifty_two_week_*`
ride along free on the Yahoo `quote()` response (back the detail page's
basic stats) and are **omitted on the Stooq fallback path** — all
optional, render whatever is present.

`finance.market_summary` — `request_response` — JSON Schema at
[`schemas/market_summary.json`](schemas/market_summary.json).

**Input** (optional)

```json
{ "sector": "Semiconductors" }
```

`sector` is optional — pass it to return only quotes in that sector
group (case-insensitive exact match against the catalog tag); omit for
the full tracked set.

**Output**

```json
{ "quotes": [ /* same Quote shape as above, one per cached symbol */ ] }
```

Each quote is enriched with `name` + `sector` so the app can group +
label client-side. Empty array if the first poll has not yet populated
the cache (handled by the renderer's empty state).

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

`finance.chart` — `request_response` — JSON Schema at
[`schemas/chart.json`](schemas/chart.json).

**Input**

```json
{ "symbol": "NVDA", "range": "1M" }
```

`symbol` is required (same tracked-list enforcement as `quote`).
`range` is optional and defaults to `"1M"`. Valid values: `"1D"`,
`"5D"`, `"1M"`, `"3M"`, `"1Y"` (shortest → longest). Unknown values
return `MeshDeny: finance_bad_range`.

**Output**

```json
{
  "symbol": "NVDA",
  "range": "1M",
  "points": [ { "t": "2026-05-13T20:00:00.000Z", "close": 905.4, "volume": 41200000 } ]
}
```

Unlike `history` (which replays the node's passively-accumulated poll
samples), `chart` fetches **live upstream OHLC** from Yahoo's chart
endpoint — intraday intervals for 1D/5D, daily bars for 1M/3M/1Y — so
the detail-page chart works on a fresh install and over spans longer
than the 90-day retention window. Responses are cached briefly per
`(symbol, range)` and never persisted. See `DECISIONS.md`
"finance.chart upstream fetch for the detail page" for why this surface,
unlike `history`, fetches upstream.

`finance.search` — `request_response` — JSON Schema at
[`schemas/search.json`](schemas/search.json).

**Input**

```json
{ "query": "lockheed" }
```

`query` is required; `limit` is optional (default 25). Catalog-only —
no upstream call.

**Output**

```json
{ "query": "lockheed", "matches": [ { "symbol": "LMT", "name": "Lockheed Martin", "sector": "Defense" } ], "count": 1 }
```

Symbol-prefix matches rank first, then symbol-substring, then
name-substring.

### Sprint 2 surfaces

Four breadth surfaces added in Sprint 2, each `request_response` with a
JSON Schema under [`schemas/`](schemas/):

- `finance.movers` — top gainers/losers across the tracked list.
- `finance.sectors` — SPDR sector-ETF performance grid.
- `finance.earnings` — upcoming earnings calendar. **Not-implemented
  stub** in this version: the surface name, schema, and voice
  registration exist, but the handler returns `{ available: false,
  reason: 'not_implemented_yet' }` until a data source
  (`yfinance.Ticker(...).earnings_dates`) is wired up.
- `finance.market_overview` — broad market snapshot (indices + breadth).

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
`$AETHER_DATA_DIR/finance/history.db` (WAL). Every successful poll
appends a row to `quotes_history (symbol, fetched_at, price, change,
change_percent)`, INSERT OR IGNORE on `(symbol, fetched_at)`. 90-day
rolling retention; older rows are pruned at the start of each poll
cycle. Persistence is honest here — every row carries its own
`fetched_at`, so consumers know exactly when each sample was
observed. The two stores together: the in-memory cache says "this is
the current price as of X minutes ago"; the SQLite series says "here
are the prices we observed at the following times." Different
questions, different storage.

Cold-start behaviour: the **`history` series** does no backfill from
training data or an upstream historical endpoint — first-day installs
honestly return empty until samples accumulate (see `DECISIONS.md`
"Finance historical quotes via passive accumulation"). The **`chart`
surface** (added for the #354 detail page) is the deliberate exception:
it fetches live upstream OHLC on demand so the detail-page chart is not
gated on accumulation — distinct concern, distinct source. The honesty
principle holds (chart bars carry real upstream timestamps); see
`DECISIONS.md` "finance.chart upstream fetch for the detail page".

## Polling

5-minute cycle. The universe is now ~95 symbols, so the cycle
**batches** — one Yahoo multi-symbol request per chunk (≤50 symbols),
with a short gap between chunks to spread latency and stay polite. If
a Yahoo batch comes back mostly-empty (fewer than half priced — the
"soft outage" Yahoo's unofficial API is prone to), the client falls
back to a single batched Stooq CSV request
(`https://stooq.com/q/l/?s=<sym1>.us,<sym2>.us,…&f=sd2t2ohlcv&h&e=csv`),
merging Yahoo's richer rows over Stooq's where both priced. The
on-demand `finance.quote` path keeps the single-symbol Yahoo → Stooq
fallback. A symbol both providers reject surfaces as `MeshDeny:
finance_unknown_symbol`; both erroring on a known symbol surfaces as
`MeshDeny: finance_provider_error`.

## Tracked symbols

A ~95-symbol curated catalog in [`src/tickers.ts`](src/tickers.ts),
each entry carrying a git-resident `sector` tag for app grouping. The
bulk is lifted verbatim from Pulse's in-git `tickerReference.json`
(symbol + name + sector — heavily semiconductor-weighted, plus defense,
mining, materials, aerospace) and merged with the Wave-1 mega-caps +
broad/sector ETFs. The sector tag is **hand-curated reference data, not
an AI classification** — the AI-classified `ticker_sectors` mapping and
the value-chain taxonomy live in local `pulse.db` and are out of scope
here; a symbol with no known sector groups under "Other / Unclassified".
Edit and rebuild to change the set; user-configurable subscriptions are
deferred to the Settings app (future PR).

## What this version does not include

- **Forex / crypto / commodities.** Stocks only.
- **Historical backfill of the `history` series.** No upstream backfill
  and no training-data fill — `history` accumulates passively from
  polling. (The `chart` surface fetches live upstream OHLC for the
  detail page; the passive `history` series still backs the sparkline.)
- **AI sector classification / value-chain / peer-compare.** Grouping
  uses only the git-resident sector tag; the `pulse.db`-backed
  classification, value-chain graph, and P/E-by-sector aggregates are a
  later lane that needs the local DB port.
- **Alerts.** No "notify me when AAPL hits 200" — composing this
  node's `quote` surface with `host_notifications.notify` is a future
  PR.

## Lifecycle markers

On successful Core registration, the node writes
`$AETHER_DATA_DIR/finance/running` containing its PID and registration
timestamp — same convention as `news_feeds/running`. The marker is
unlinked on graceful shutdown.

## Required env

| Var | Source | Notes |
|---|---|---|
| `MESH_FINANCE_SECRET` | shell secrets bag | hex-32 per cold start |
| `MESH_CORE_URL` | shell coreManager | defaults to `http://127.0.0.1:8000` |
| `AETHER_DATA_DIR` | shell nodeManager | writable root for the liveness marker |

The node refuses to start without `MESH_FINANCE_SECRET` or
`AETHER_DATA_DIR`. `MESH_CORE_URL` falls back to localhost for
convenience when running the node by hand outside the shell. No
upstream API key is required — Yahoo Finance and Stooq are both
anonymous endpoints.
