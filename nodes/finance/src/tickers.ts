// Hardcoded ticker list for v1. User-configurable tickers come with the
// Settings app (future PR). Edit and rebuild the node to change the set;
// add/remove freely — the storage layer is keyed by symbol so churn
// doesn't pile up stale entries.
//
// Selection criteria: liquid US equities + the headline broad-market
// ETFs (SPY/QQQ/DIA). Ten symbols fits a 3-col grid in ~4 rows on the
// renderer without scroll, and at the 5-min × 30-s stagger cadence
// uses ~2 req/min — well under Finnhub's free-tier 60-req/min ceiling.
export interface TickerSource {
  /** US ticker symbol. UPPERCASE; the client normalises before
   *  request and the Quote.symbol is always upper. */
  symbol: string
  /** Display name used for voice readbacks ("Apple is up two percent"). */
  name: string
}

export const TICKERS: TickerSource[] = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'NVDA', name: 'Nvidia' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'SPY', name: 'S&P 500 ETF' },
  { symbol: 'QQQ', name: 'Nasdaq 100 ETF' },
  { symbol: 'DIA', name: 'Dow Jones ETF' },
]

/** Quick membership check used by the per-symbol surface handler. */
export function isTracked(symbol: string): boolean {
  const upper = symbol.toUpperCase()
  return TICKERS.some((t) => t.symbol === upper)
}
