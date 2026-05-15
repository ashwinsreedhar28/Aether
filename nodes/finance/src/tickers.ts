// Hardcoded ticker list for v1. User-configurable tickers come with the
// Settings app (future PR). Edit and rebuild the node to change the set;
// add/remove freely — the storage layer is keyed by symbol so churn
// doesn't pile up stale entries.
//
// Selection criteria: liquid US equities + the headline broad-market
// ETFs (SPY/QQQ/DIA) + SPDR sector ETFs (XLK, XLF, etc.). 21 symbols at
// 5-min cycle × 30-s stagger = ~4.2 req/min — still polite for anonymous
// Yahoo / Stooq use.
export interface TickerSource {
  /** US ticker symbol. UPPERCASE; the client normalises before
   *  request and the Quote.symbol is always upper. */
  symbol: string
  /** Display name used for voice readbacks ("Apple is up two percent"). */
  name: string
}

export const TICKERS: TickerSource[] = [
  // Mag-7 + popular consumer equities
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'NVDA', name: 'Nvidia' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'META', name: 'Meta' },
  // Broad market ETFs
  { symbol: 'SPY', name: 'S&P 500 ETF' },
  { symbol: 'QQQ', name: 'Nasdaq 100 ETF' },
  { symbol: 'DIA', name: 'Dow Jones ETF' },
  // SPDR sector ETFs (added for finance.sectors surface)
  { symbol: 'XLK', name: 'Technology Select Sector' },
  { symbol: 'XLF', name: 'Financial Select Sector' },
  { symbol: 'XLV', name: 'Health Care Select Sector' },
  { symbol: 'XLY', name: 'Consumer Discretionary Select Sector' },
  { symbol: 'XLP', name: 'Consumer Staples Select Sector' },
  { symbol: 'XLI', name: 'Industrial Select Sector' },
  { symbol: 'XLE', name: 'Energy Select Sector' },
  { symbol: 'XLU', name: 'Utilities Select Sector' },
  { symbol: 'XLB', name: 'Materials Select Sector' },
  { symbol: 'XLRE', name: 'Real Estate Select Sector' },
  { symbol: 'XLC', name: 'Communication Services Select Sector' },
]

/** Quick membership check used by the per-symbol surface handler. */
export function isTracked(symbol: string): boolean {
  const upper = symbol.toUpperCase()
  return TICKERS.some((t) => t.symbol === upper)
}
