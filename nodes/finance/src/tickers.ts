// The finance node's universe. Each entry carries a git-resident,
// hand-curated `sector` tag — NOT an AI classification. The bulk (the 75
// equities below the Wave-1 block) is lifted verbatim from Pulse's
// in-git `src/data/tickerReference.json` (symbol + name + sector; the
// `industry`/`aliases` columns are dropped — we don't group on them, see
// CLAUDE.md §11.8). The Wave-1 handful (Mag-7 + broad/sector ETFs) keeps
// its own curated sector tags so the whole set groups cleanly.
//
// Scope note (issue #354): grouping uses ONLY this git-resident sector
// tag. The AI-classified per-ticker `ticker_sectors` mapping and the
// value-chain taxonomy live in local `pulse.db` and are explicitly NOT
// in this lane — a ticker with no known sector falls into
// "Other / Unclassified", never a fabricated guess.
//
// The set is heavily semiconductor-weighted (it is Pulse's domain
// watchlist, not a diversified index) — that is the git-resident reality
// behind the spec's "~500" estimate (the actual catalog is ~95). It is
// still large enough that a flat grid is unusable, which is what the
// app-redesign half of #354 answers (search + sector grouping).
//
// At ~95 symbols a per-symbol 30s stagger would take ~47 min/cycle, so
// the poller now batches (one Yahoo multi-symbol call per chunk, Stooq
// batched fallback) — see poller.ts.
export interface TickerSource {
  /** US ticker symbol. UPPERCASE; the client normalises before request
   *  and Quote.symbol is always upper. */
  symbol: string
  /** Display name — voice readbacks + the app's card subtitle. */
  name: string
  /** Curated, git-resident sector label used for app grouping. Never an
   *  AI classification (see header). */
  sector: string
}

// Sector display order (§11.1 — semantic, not alphabetical). Larger /
// more salient groups first; broad-index funds last. Sectors not listed
// here sort after these (alpha) but before the catch-all
// "Other / Unclassified", which the app always pins to the very end.
export const SECTOR_ORDER: string[] = [
  'Semiconductors',
  'Software',
  'Internet & Media',
  'Technology Hardware',
  'Cloud Infrastructure',
  'Electronic Components',
  'Electronic Manufacturing',
  'Defense',
  'Aerospace',
  'Automotive',
  'Industrials',
  'Mining',
  'Materials',
  'Consumer & Retail',
  'Sector ETFs',
  'Index ETFs',
]

/** Label for tickers whose sector is unknown. */
export const UNCLASSIFIED = 'Other / Unclassified'

export const TICKERS: TickerSource[] = [
  // ── Wave-1 mega-caps (curated sectors; NVDA lives in the lifted block
  //    below so it isn't duplicated) ──
  { symbol: 'AAPL', name: 'Apple', sector: 'Technology Hardware' },
  { symbol: 'MSFT', name: 'Microsoft', sector: 'Software' },
  { symbol: 'GOOGL', name: 'Alphabet', sector: 'Internet & Media' },
  { symbol: 'AMZN', name: 'Amazon', sector: 'Consumer & Retail' },
  { symbol: 'TSLA', name: 'Tesla', sector: 'Automotive' },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Internet & Media' },

  // ── Broad-market index ETFs ──
  { symbol: 'SPY', name: 'S&P 500 ETF', sector: 'Index ETFs' },
  { symbol: 'QQQ', name: 'Nasdaq 100 ETF', sector: 'Index ETFs' },
  { symbol: 'DIA', name: 'Dow Jones ETF', sector: 'Index ETFs' },

  // ── SPDR sector ETFs (back finance.sectors; de-duped out of the grid
  //    by the app into the Sectors strip) ──
  { symbol: 'XLK', name: 'Technology Select Sector', sector: 'Sector ETFs' },
  { symbol: 'XLF', name: 'Financial Select Sector', sector: 'Sector ETFs' },
  { symbol: 'XLV', name: 'Health Care Select Sector', sector: 'Sector ETFs' },
  { symbol: 'XLY', name: 'Consumer Discretionary Select Sector', sector: 'Sector ETFs' },
  { symbol: 'XLP', name: 'Consumer Staples Select Sector', sector: 'Sector ETFs' },
  { symbol: 'XLI', name: 'Industrial Select Sector', sector: 'Sector ETFs' },
  { symbol: 'XLE', name: 'Energy Select Sector', sector: 'Sector ETFs' },
  { symbol: 'XLU', name: 'Utilities Select Sector', sector: 'Sector ETFs' },
  { symbol: 'XLB', name: 'Materials Select Sector', sector: 'Sector ETFs' },
  { symbol: 'XLRE', name: 'Real Estate Select Sector', sector: 'Sector ETFs' },
  { symbol: 'XLC', name: 'Communication Services Select Sector', sector: 'Sector ETFs' },

  // ── Lifted from Pulse src/data/tickerReference.json (in git) ──
  { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'Semiconductors' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Semiconductors' },
  { symbol: 'AVGO', name: 'Broadcom Inc.', sector: 'Semiconductors' },
  { symbol: 'QCOM', name: 'Qualcomm', sector: 'Semiconductors' },
  { symbol: 'MRVL', name: 'Marvell Technology', sector: 'Semiconductors' },
  { symbol: 'ARM', name: 'Arm Holdings', sector: 'Semiconductors' },
  { symbol: 'AMBA', name: 'Ambarella', sector: 'Semiconductors' },
  { symbol: 'LSCC', name: 'Lattice Semiconductor', sector: 'Semiconductors' },
  { symbol: 'ALGM', name: 'Allegro MicroSystems', sector: 'Semiconductors' },
  { symbol: 'INTC', name: 'Intel Corporation', sector: 'Semiconductors' },
  { symbol: 'TXN', name: 'Texas Instruments', sector: 'Semiconductors' },
  { symbol: 'ADI', name: 'Analog Devices', sector: 'Semiconductors' },
  { symbol: 'ON', name: 'onsemi', sector: 'Semiconductors' },
  { symbol: 'MU', name: 'Micron Technology', sector: 'Semiconductors' },
  { symbol: 'STM', name: 'STMicroelectronics', sector: 'Semiconductors' },
  { symbol: 'NXPI', name: 'NXP Semiconductors', sector: 'Semiconductors' },
  { symbol: 'MCHP', name: 'Microchip Technology', sector: 'Semiconductors' },
  { symbol: 'WOLF', name: 'Wolfspeed', sector: 'Semiconductors' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor Manufacturing', sector: 'Semiconductors' },
  { symbol: 'GFS', name: 'GlobalFoundries', sector: 'Semiconductors' },
  { symbol: 'UMC', name: 'United Microelectronics', sector: 'Semiconductors' },
  { symbol: 'TSEM', name: 'Tower Semiconductor', sector: 'Semiconductors' },
  { symbol: 'ASML', name: 'ASML Holding', sector: 'Semiconductors' },
  { symbol: 'AMAT', name: 'Applied Materials', sector: 'Semiconductors' },
  { symbol: 'LRCX', name: 'Lam Research', sector: 'Semiconductors' },
  { symbol: 'KLAC', name: 'KLA Corporation', sector: 'Semiconductors' },
  { symbol: 'TER', name: 'Teradyne', sector: 'Semiconductors' },
  { symbol: 'ONTO', name: 'Onto Innovation', sector: 'Semiconductors' },
  { symbol: 'ACMR', name: 'ACM Research', sector: 'Semiconductors' },
  { symbol: 'AEHR', name: 'Aehr Test Systems', sector: 'Semiconductors' },
  { symbol: 'UCTT', name: 'Ultra Clean Holdings', sector: 'Semiconductors' },
  { symbol: 'ACLS', name: 'Axcelis Technologies', sector: 'Semiconductors' },
  { symbol: 'COHR', name: 'Coherent Corp.', sector: 'Semiconductors' },
  { symbol: 'FORM', name: 'FormFactor', sector: 'Semiconductors' },
  { symbol: 'SNPS', name: 'Synopsys', sector: 'Semiconductors' },
  { symbol: 'CDNS', name: 'Cadence Design Systems', sector: 'Semiconductors' },
  { symbol: 'AMKR', name: 'Amkor Technology', sector: 'Semiconductors' },
  { symbol: 'ASX', name: 'ASE Technology Holding', sector: 'Semiconductors' },
  { symbol: 'ENTG', name: 'Entegris', sector: 'Semiconductors' },
  { symbol: 'MKSI', name: 'MKS Instruments', sector: 'Semiconductors' },
  { symbol: 'LIN', name: 'Linde plc', sector: 'Materials' },
  { symbol: 'APD', name: 'Air Products and Chemicals', sector: 'Materials' },
  { symbol: 'AIQUY', name: 'Air Liquide', sector: 'Materials' },
  { symbol: 'HOCPY', name: 'Hoya Corporation', sector: 'Semiconductors' },
  { symbol: 'LMT', name: 'Lockheed Martin', sector: 'Defense' },
  { symbol: 'NOC', name: 'Northrop Grumman', sector: 'Defense' },
  { symbol: 'RTX', name: 'RTX Corporation', sector: 'Defense' },
  { symbol: 'GD', name: 'General Dynamics', sector: 'Defense' },
  { symbol: 'BA', name: 'Boeing', sector: 'Aerospace' },
  { symbol: 'LHX', name: 'L3Harris Technologies', sector: 'Defense' },
  { symbol: 'HII', name: 'Huntington Ingalls Industries', sector: 'Defense' },
  { symbol: 'KTOS', name: 'Kratos Defense & Security', sector: 'Defense' },
  { symbol: 'MRCY', name: 'Mercury Systems', sector: 'Defense' },
  { symbol: 'TDG', name: 'TransDigm Group', sector: 'Aerospace' },
  { symbol: 'MP', name: 'MP Materials', sector: 'Mining' },
  { symbol: 'LAC', name: 'Lithium Americas', sector: 'Mining' },
  { symbol: 'ALB', name: 'Albemarle', sector: 'Mining' },
  { symbol: 'SQM', name: 'Sociedad Química y Minera', sector: 'Mining' },
  { symbol: 'FCX', name: 'Freeport-McMoRan', sector: 'Mining' },
  { symbol: 'SCCO', name: 'Southern Copper', sector: 'Mining' },
  { symbol: 'RIO', name: 'Rio Tinto', sector: 'Mining' },
  { symbol: 'BHP', name: 'BHP Group', sector: 'Mining' },
  { symbol: 'VALE', name: 'Vale S.A.', sector: 'Mining' },
  { symbol: 'NEM', name: 'Newmont', sector: 'Mining' },
  { symbol: 'USAR', name: 'USA Rare Earth', sector: 'Mining' },
  { symbol: 'APH', name: 'Amphenol', sector: 'Electronic Components' },
  { symbol: 'CLS', name: 'Celestica', sector: 'Electronic Manufacturing' },
  { symbol: 'CRWV', name: 'CoreWeave', sector: 'Cloud Infrastructure' },
  { symbol: 'GLW', name: 'Corning', sector: 'Materials' },
  { symbol: 'CRDO', name: 'Credo Technology Group', sector: 'Semiconductors' },
  { symbol: 'LITE', name: 'Lumentum', sector: 'Semiconductors' },
  { symbol: 'MPWR', name: 'Monolithic Power Systems', sector: 'Semiconductors' },
  { symbol: 'RKLB', name: 'Rocket Lab Corporation', sector: 'Aerospace' },
  { symbol: 'SNDK', name: 'Sandisk Corporation', sector: 'Semiconductors' },
  { symbol: 'VRT', name: 'Vertiv', sector: 'Industrials' },
]

const BY_SYMBOL: Map<string, TickerSource> = new Map(
  TICKERS.map((t) => [t.symbol, t]),
)

/** Quick membership check used by the per-symbol surface handlers. */
export function isTracked(symbol: string): boolean {
  return BY_SYMBOL.has(symbol.toUpperCase())
}

/** Catalog entry for a symbol, or undefined if untracked. Used to enrich
 *  quotes with name + sector at the surface boundary. */
export function findTicker(symbol: string): TickerSource | undefined {
  return BY_SYMBOL.get(symbol.toUpperCase())
}

/** Substring search over symbol + name (case-insensitive). Backs
 *  finance.search / the app's search box and the stock_search voice tool.
 *  Catalog-only — no upstream call. Symbol-prefix matches rank first, then
 *  symbol-substring, then name-substring; ties keep catalog order. */
export function searchTickers(query: string, limit = 25): TickerSource[] {
  const q = query.trim().toUpperCase()
  if (!q) return []
  const symbolPrefix: TickerSource[] = []
  const symbolContains: TickerSource[] = []
  const nameContains: TickerSource[] = []
  for (const t of TICKERS) {
    const sym = t.symbol
    const name = t.name.toUpperCase()
    if (sym.startsWith(q)) symbolPrefix.push(t)
    else if (sym.includes(q)) symbolContains.push(t)
    else if (name.includes(q)) nameContains.push(t)
  }
  return [...symbolPrefix, ...symbolContains, ...nameContains].slice(0, limit)
}
