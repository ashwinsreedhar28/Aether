### Added
- The Viewer gains a **Stocks** app (`shell/src/apps/stocks`, auto-discovered
  in the Console like every other app) — Wave 1 of the Pulse vertical, the
  live quote dashboard over the existing `finance` Sensor (#345). Read-only:
  a tracked-ticker grid (`finance.market_summary`, polled at 30s) of cards
  showing symbol, price, day change + percent (green up / red down), share
  volume, and a ~24h price sparkline per card (`finance.history` `1d`),
  under a "Movers" panel (top gainers/losers from `finance.movers`) and a
  coloured "Sectors" strip (`finance.sectors`); a subtle "as of" stamp reads
  the freshest `Quote.fetched_at`. Sector ETFs are de-duplicated out of the
  grid into the Sectors strip using the sectors payload itself (no hardcoded
  XL* list), and fall back into the grid when sectors is unavailable. Voice
  reaches it by auto-discovery — `'stocks'` joins `APP_HINTS` in
  `viewer_tool.py` and a one-line `open_app` note lands in `prompts.json`
  ("open the stocks app" → `open_app` id `stocks`); the `finance_*` voice
  tools are unchanged. The manifest needed zero changes: the
  `shell → finance.{market_summary,history,movers,sectors}` edges already
  existed. Closes #345.
