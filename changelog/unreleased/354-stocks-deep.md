### Added
- **Stocks app — per-ticker detail page + search + sector grouping** (#354).
  The Stocks app gains a per-ticker **detail page** (opens from any card):
  a price chart across **1D / 5D / 1M / 3M / 1Y** backed by a new
  `finance.chart` surface (live upstream Yahoo OHLC — works on a fresh
  install and beyond the 90-day `history` retention window), plus the live
  quote and basic stats (P/E, market cap, day range, 52-week range, open,
  volume). The grid is now **searchable** (by symbol or name, over a new
  `finance.search` catalog surface) and **grouped into collapsible sector
  sections** (semantic order, not alphabetical), with per-card sparklines
  loaded lazily for visible cards. Two new voice tools: `stock_detail`
  ("show me NVDA", "how's AAPL over the last month" — combined price +
  trend readback) and `stock_search` ("find lockheed stock" — resolve a
  company name to a tracked ticker). New manifest surfaces
  `finance.chart` + `finance.search` with `shell`/`raven` edges.

### Changed
- **finance node — universe expansion to ~95 symbols** (#354). The tracked
  set grows from the Wave-1 handful to a ~95-symbol curated, sector-tagged
  catalog (the bulk lifted verbatim from Pulse's in-git
  `tickerReference.json`; sector tags are hand-curated reference data, not
  AI classification). `finance.market_summary` quotes are now enriched with
  catalog `name` + `sector` and accept an optional `sector` filter; the
  Yahoo `quote()` mapping now also captures open / day range / P/E / market
  cap / 52-week range (all optional; absent on the Stooq fallback). The
  poller **batches** (one Yahoo multi-symbol request per ≤50-symbol chunk,
  batched Stooq CSV fallback) so the larger universe still refreshes within
  the 5-minute cycle.
