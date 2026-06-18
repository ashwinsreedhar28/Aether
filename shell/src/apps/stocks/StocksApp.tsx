import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronRight, RefreshCw, Search, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useMeshSurface } from '../../hooks/useMeshSurface';
import { StockDetail } from './StockDetail';
import { UP, DOWN, UNCLASSIFIED, fmtChange, fmtPct, fmtPrice, fmtVolume, orderSectors, tone } from './format';

// The finance vertical's face. Wave 1 (#345) shipped a flat ~21-card grid;
// #354 takes it to the full ~95-symbol universe, which a flat grid can't
// carry — so the grid is now SEARCHABLE (by symbol/name) and GROUPED into
// collapsible sector sections, and every card opens a per-ticker DETAIL page
// (price chart across 1D/5D/1M/3M/1Y + basic stats). Still a MeshApp over
// shell → finance.{market_summary,quote,history,chart,search}; voice drives
// the finance_*/stock_* tools, the app is the visible surface.

// Quote shape mirrored from nodes/finance/src/types.ts. market_summary now
// enriches each quote with name + sector (filled by the node from its
// catalog) so the app can group + label without a second round-trip.
interface Quote {
  symbol: string;
  price: number;
  change: number;
  change_percent: number;
  volume: number;
  latest_trading_day: string;
  fetched_at: string;
  name?: string;
  sector?: string;
}
interface MarketSummaryPayload {
  quotes: Quote[];
}

interface HistoryPoint {
  fetched_at: string;
  price: number;
  change_percent: number;
}
interface HistoryPayload {
  points: HistoryPoint[];
}

interface MoversPayload {
  available: boolean;
  gainers?: Quote[];
  losers?: Quote[];
  reason?: string;
}

interface Sector {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_percent: number;
}
interface SectorsPayload {
  available: boolean;
  sectors?: Sector[];
  reason?: string;
}

// Freshest upstream fetch across the grid → a subtle "as of" stamp. Uses the
// Quote.fetched_at the node stamped, not the renderer's own fetch time.
function fmtAsOf(quotes: Quote[]): string | null {
  let max = 0;
  for (const q of quotes) {
    const t = Date.parse(q.fetched_at);
    if (Number.isFinite(t) && t > max) max = t;
  }
  if (!max) return null;
  return new Date(max).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

const SPARK_MIN = 3;

/**
 * Inline price sparkline (~24h, finance.history period '1d'). Renders nothing
 * below SPARK_MIN points — a 2-point line is noise, and first-day installs
 * honestly have none.
 */
function Sparkline({ points, color }: { points: HistoryPoint[]; color: string }) {
  const w = 96;
  const h = 28;
  if (points.length < SPARK_MIN) {
    return (
      <div
        style={{ width: w, height: h, flexShrink: 0 }}
        className="flex items-center justify-center text-[10px] text-[var(--holo-muted)]"
      >
        no history yet
      </div>
    );
  }
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const pad = 2;
  const stepX = (w - pad * 2) / (points.length - 1);
  const d = points
    .map((p, i) => {
      const x = pad + i * stepX;
      const y = pad + (1 - (p.price - min) / span) * (h - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function QuoteCard({
  quote,
  points,
  onSelect,
}: {
  quote: Quote;
  points: HistoryPoint[];
  onSelect: (symbol: string) => void;
}) {
  const color = tone(quote.change_percent);
  const up = quote.change_percent > 0;
  const down = quote.change_percent < 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(quote.symbol)}
      className="text-left rounded-lg border p-3 flex flex-col gap-2 hover:border-[var(--holo-accent)] transition-colors"
      style={{ borderColor: 'var(--holo-border)', background: 'var(--holo-panel)' }}
      title={quote.name ? `${quote.name} — open detail` : 'Open detail'}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-wide truncate">{quote.symbol}</div>
          {quote.name && (
            <div className="text-[10px] text-[var(--holo-muted)] truncate">{quote.name}</div>
          )}
          <div className="text-lg font-medium" style={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
            {fmtPrice(quote.price)}
          </div>
        </div>
        <div className="text-right flex flex-col items-end" style={{ color }}>
          <span className="flex items-center gap-1 text-sm font-medium" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {up && <TrendingUp size={13} />}
            {down && <TrendingDown size={13} />}
            {fmtPct(quote.change_percent)}
          </span>
          <span className="text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {fmtChange(quote.change)}
          </span>
        </div>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-[10px] text-[var(--holo-muted)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
          Vol {fmtVolume(quote.volume)}
        </span>
        <Sparkline points={points} color={color} />
      </div>
    </button>
  );
}

function MoverRow({ quote }: { quote: Quote }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-xs font-medium">{quote.symbol}</span>
      <span className="text-xs" style={{ color: tone(quote.change_percent), fontVariantNumeric: 'tabular-nums' }}>
        {fmtPct(quote.change_percent)}
      </span>
    </div>
  );
}

// Fetch finance.history('1d') for a set of symbols in small sequential
// batches so expanding a 45-card sector doesn't fire 45 invokes at once.
async function loadHistoriesChunked(
  symbols: string[],
  apply: (next: Record<string, HistoryPoint[]>) => void,
): Promise<void> {
  const CHUNK = 12;
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const chunk = symbols.slice(i, i + CHUNK);
    const results = await Promise.allSettled(
      chunk.map((symbol) => window.aether.mesh.invoke('finance.history', { symbol, period: '1d' })),
    );
    const next: Record<string, HistoryPoint[]> = {};
    results.forEach((res, j) => {
      const symbol = chunk[j];
      if (!symbol) return;
      if (res.status === 'fulfilled' && res.value.ok && res.value.envelope) {
        const payload = res.value.envelope.payload as unknown as HistoryPayload;
        next[symbol] = Array.isArray(payload.points) ? payload.points : [];
      }
    });
    apply(next);
  }
}

export function StocksApp() {
  const grid = useMeshSurface<MarketSummaryPayload>('finance.market_summary', {}, {
    pollMs: 30000,
    cacheKey: 'stocks-grid',
  });
  const movers = useMeshSurface<MoversPayload>('finance.movers', {}, {
    pollMs: 30000,
    cacheKey: 'stocks-movers',
  });
  const sectors = useMeshSurface<SectorsPayload>('finance.sectors', {}, {
    pollMs: 30000,
    cacheKey: 'stocks-sectors',
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [histories, setHistories] = useState<Record<string, HistoryPoint[]>>({});

  const quotes = useMemo(() => grid.data?.quotes ?? [], [grid.data]);

  // Sector ETFs (XL*) get their own coloured strip below — drop them from the
  // grid so a card and a strip chip don't show the same symbol twice. Dedup
  // set comes from the sectors payload itself (runtime-driven, not a hardcoded
  // XL* list per §11).
  const sectorSymbols = useMemo(
    () => new Set((sectors.data?.sectors ?? []).map((s) => s.symbol)),
    [sectors.data],
  );
  const gridQuotes = useMemo(
    () => quotes.filter((q) => !sectorSymbols.has(q.symbol)),
    [quotes, sectorSymbols],
  );

  // Search filter (symbol or name, case-insensitive).
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return gridQuotes;
    return gridQuotes.filter(
      (item) => item.symbol.toLowerCase().includes(q) || (item.name ?? '').toLowerCase().includes(q),
    );
  }, [gridQuotes, q]);

  // Group by sector, ordered semantically.
  const groups = useMemo(() => {
    const map = new Map<string, Quote[]>();
    for (const item of filtered) {
      const key = item.sector ?? UNCLASSIFIED;
      const arr = map.get(key);
      if (arr) arr.push(item);
      else map.set(key, [item]);
    }
    return orderSectors([...map.keys()]).map((name) => ({ name, items: map.get(name)! }));
  }, [filtered]);

  // A searching session ignores collapse state (matches should be visible).
  const searching = q.length > 0;
  const isOpen = useCallback(
    (sector: string) => searching || !collapsed.has(sector),
    [searching, collapsed],
  );

  // Lazy sparklines: only fetch histories for symbols currently rendered
  // (expanded, query-matching groups) and not already loaded.
  const visibleSymbols = useMemo(() => {
    const out: string[] = [];
    for (const g of groups) {
      if (!isOpen(g.name)) continue;
      for (const item of g.items) out.push(item.symbol);
    }
    return out;
  }, [groups, isOpen]);

  useEffect(() => {
    const missing = visibleSymbols.filter((s) => !(s in histories));
    if (missing.length === 0) return;
    void loadHistoriesChunked(missing, (next) => setHistories((prev) => ({ ...prev, ...next })));
  }, [visibleSymbols, histories]);

  const toggleSector = (sector: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(sector)) next.delete(sector);
      else next.add(sector);
      return next;
    });
  };

  const refreshAll = () => {
    grid.refetch();
    movers.refetch();
    sectors.refetch();
    // Drop cached histories so visible cards re-pull on the next effect tick.
    setHistories({});
  };

  if (selected) {
    return <StockDetail key={selected} symbol={selected} onBack={() => setSelected(null)} />;
  }

  const asOf = fmtAsOf(quotes);
  const offline = grid.error != null && quotes.length > 0;
  const moversData = movers.data;
  const sectorsData = sectors.data;
  const gainers = moversData?.available ? (moversData.gainers ?? []).slice(0, 3) : [];
  const losers = moversData?.available ? (moversData.losers ?? []).slice(0, 3) : [];
  const sectorList = sectorsData?.available ? (sectorsData.sectors ?? []) : [];

  return (
    <div className="w-full h-full flex flex-col bg-[var(--holo-bg)] text-[var(--holo-text)]">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-[var(--holo-border)]">
        <TrendingUp size={18} className="text-[var(--holo-accent)]" />
        <h1 className="text-sm font-medium">Stocks</h1>
        {asOf && <span className="text-xs text-[var(--holo-muted)]">as of {asOf}</span>}
        <button
          onClick={refreshAll}
          className="ml-auto text-[var(--holo-muted)] hover:text-[var(--holo-accent)] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} className={grid.refreshing ? 'animate-spin' : ''} />
        </button>
      </header>

      {/* Search */}
      <div className="px-4 py-2 border-b border-[var(--holo-border)]">
        <div
          className="flex items-center gap-2 rounded-md border px-2 py-1"
          style={{ borderColor: 'var(--holo-border)', background: 'var(--holo-panel)' }}
        >
          <Search size={14} className="text-[var(--holo-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol or name…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--holo-muted)]"
            spellCheck={false}
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-[var(--holo-muted)] hover:text-[var(--holo-accent)]" title="Clear">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {offline && (
        <p className="text-xs text-amber-300 px-4 py-1.5 border-b border-[var(--holo-border)]">
          Live fetch failing ({grid.error}) — showing last quotes{asOf ? ` as of ${asOf}` : ''}
        </p>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {grid.loading && <p className="text-sm text-[var(--holo-muted)] px-1">Reading the market…</p>}

        {!grid.loading && grid.error && quotes.length === 0 && (
          <p className="text-sm text-amber-300 px-1">{grid.error}</p>
        )}

        {!grid.loading && !grid.error && quotes.length === 0 && (
          <div className="flex flex-col items-center gap-2 text-center py-10">
            <Activity size={48} style={{ color: 'rgba(255,255,255,0.1)' }} />
            <p className="text-sm text-[var(--holo-muted)]">No quotes yet</p>
            <p className="text-xs text-[var(--holo-muted)]">The finance poller is warming up.</p>
          </div>
        )}

        {quotes.length > 0 && groups.length === 0 && (
          <p className="text-sm text-[var(--holo-muted)] px-1">No matches for “{query}”.</p>
        )}

        {/* Grouped, collapsible sector sections */}
        {groups.map((g) => {
          const open = isOpen(g.name);
          return (
            <section key={g.name}>
              <button
                type="button"
                onClick={() => toggleSector(g.name)}
                className="w-full flex items-center gap-1.5 px-1 mb-1.5 text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
              >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <h2 className="text-xs font-medium uppercase tracking-wider">{g.name}</h2>
                <span className="text-[10px] opacity-70">{g.items.length}</span>
              </button>
              {open && (
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  {g.items.map((item) => (
                    <QuoteCard
                      key={item.symbol}
                      quote={item}
                      points={histories[item.symbol] ?? []}
                      onSelect={setSelected}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {/* Movers + Sectors strips stay below the grouped grid (hidden while searching) */}
        {!searching && (gainers.length > 0 || losers.length > 0) && (
          <section>
            <h2 className="text-xs font-medium text-[var(--holo-muted)] uppercase tracking-wider mb-1.5 px-1">Movers</h2>
            <div
              className="grid gap-3 rounded-lg border p-3"
              style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', borderColor: 'var(--holo-border)', background: 'var(--holo-panel)' }}
            >
              <div>
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider mb-1" style={{ color: UP }}>
                  <TrendingUp size={11} /> Gainers
                </div>
                {gainers.map((item) => (
                  <MoverRow key={item.symbol} quote={item} />
                ))}
              </div>
              <div>
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider mb-1" style={{ color: DOWN }}>
                  <TrendingDown size={11} /> Losers
                </div>
                {losers.map((item) => (
                  <MoverRow key={item.symbol} quote={item} />
                ))}
              </div>
            </div>
          </section>
        )}

        {!searching && sectorList.length > 0 && (
          <section>
            <h2 className="text-xs font-medium text-[var(--holo-muted)] uppercase tracking-wider mb-1.5 px-1">Sectors</h2>
            <div className="flex flex-wrap gap-1.5">
              {sectorList.map((s) => (
                <div
                  key={s.symbol}
                  className="rounded-md border px-2 py-1 flex items-center gap-1.5"
                  style={{ borderColor: 'var(--holo-border)', background: 'var(--holo-panel)' }}
                  title={s.name}
                >
                  <span className="text-[11px] font-medium">{s.name}</span>
                  <span className="text-[11px]" style={{ color: tone(s.change_percent), fontVariantNumeric: 'tabular-nums' }}>
                    {fmtPct(s.change_percent)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
