import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { useMeshSurface } from '../../hooks/useMeshSurface';

// The finance vertical's face (Wave 1 of the Pulse-vertical program, mirrors
// music Lane B #335). finance is a Sensor — it already polls quotes (Yahoo →
// Stooq) for the tracked tickers on its own cadence; this app is read-only,
// re-homing Pulse's quote grid as a MeshApp over the manifest's
// shell → finance.{market_summary,history,movers,sectors} edges (all
// pre-existing — this lane adds NO edges). Voice still drives finance_* tools;
// the app is the visible surface, not a new control path.

// Quote shape mirrored from nodes/finance/src/types.ts (single source of truth
// lives there; redeclared locally like MusicApp redeclares NowPlayingTrack —
// no cross-workspace import of node types from the renderer).
interface Quote {
  symbol: string;
  price: number;
  change: number;
  change_percent: number;
  volume: number;
  latest_trading_day: string;
  fetched_at: string;
}
interface MarketSummaryPayload {
  quotes: Quote[];
}

// finance.history → { points } where each point is the narrow sparkline shape
// (nodes/finance/src/history.ts HistoryPoint). Empty array is the honest
// first-day answer; the node skips its own readback below 2 samples and the
// renderer skips the sparkline below 3 points (SPARK_MIN).
interface HistoryPoint {
  fetched_at: string;
  price: number;
  change_percent: number;
}
interface HistoryPayload {
  points: HistoryPoint[];
}

// finance.movers → top gainers/losers by change_percent, or { available:false }
// on a cold cache. gainers/losers are full Quote rows (the node re-cuts the
// same tracked set the grid reads).
interface MoversPayload {
  available: boolean;
  gainers?: Quote[];
  losers?: Quote[];
  reason?: string;
}

// finance.sectors → SPDR sector ETF quotes enriched with a human sector name,
// or { available:false } until the poller has populated the XL* tickers.
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

// Tone palette: emerald up / red down / muted flat. Inline colours (not
// Tailwind classes) so the same value drives both text and the SVG stroke.
const UP = '#34d399'; // emerald-400
const DOWN = '#f87171'; // red-400
function tone(n: number): string {
  if (!Number.isFinite(n) || n === 0) return 'var(--holo-muted)';
  return n > 0 ? UP : DOWN;
}

function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtChange(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}`;
}
function fmtPct(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}
// Compact share volume: 1.2B / 40.3M / 812K. 0 means the upstream omitted it
// (rare, per the Quote.volume doc) — render an em dash rather than "0".
function fmtVolume(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}
// Freshest upstream fetch across the grid → a subtle "as of" stamp. Uses the
// Quote.fetched_at the node stamped (when it last polled the market), not the
// renderer's own fetch time — the honest "as of" is the data's age.
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
 * Inline price sparkline (~24h, finance.history period '1d'). A single
 * polyline over the point series, normalised to the box, stroked in the
 * quote's tone. Renders nothing below SPARK_MIN points — a 2-point line is
 * noise, and first-day installs honestly have none.
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
      // Invert Y: higher price → smaller y (top of the box).
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

function QuoteCard({ quote, points }: { quote: Quote; points: HistoryPoint[] }) {
  const color = tone(quote.change_percent);
  const up = quote.change_percent > 0;
  const down = quote.change_percent < 0;
  return (
    <div
      className="rounded-lg border p-3 flex flex-col gap-2"
      style={{ borderColor: 'var(--holo-border)', background: 'var(--holo-panel)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-wide truncate" title={quote.symbol}>
            {quote.symbol}
          </div>
          <div
            className="text-lg font-medium"
            style={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}
          >
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
    </div>
  );
}

function MoverRow({ quote }: { quote: Quote }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-xs font-medium">{quote.symbol}</span>
      <span
        className="text-xs"
        style={{ color: tone(quote.change_percent), fontVariantNumeric: 'tabular-nums' }}
      >
        {fmtPct(quote.change_percent)}
      </span>
    </div>
  );
}

export function StocksApp() {
  // Primary read: the tracked-ticker grid. Options verbatim from the spec.
  const grid = useMeshSurface<MarketSummaryPayload>('finance.market_summary', {}, {
    pollMs: 30000,
    cacheKey: 'stocks-grid',
  });
  // Secondary panels — same 30s cadence, cheap cache reads on the node side.
  const movers = useMeshSurface<MoversPayload>('finance.movers', {}, {
    pollMs: 30000,
    cacheKey: 'stocks-movers',
  });
  const sectors = useMeshSurface<SectorsPayload>('finance.sectors', {}, {
    pollMs: 30000,
    cacheKey: 'stocks-sectors',
  });

  const quotes = grid.data?.quotes ?? [];

  // Sector ETFs (XL*) get their own coloured strip below — drop them from the
  // grid so a card and a strip chip don't show the same symbol twice. The
  // dedup set comes from the sectors payload itself (runtime-driven, not a
  // hardcoded XL* list per §11), so if sectors is unavailable the ETFs simply
  // fall back into the grid rather than vanishing.
  const sectorSymbols = new Set((sectors.data?.sectors ?? []).map((s) => s.symbol));
  const gridQuotes = quotes.filter((q) => !sectorSymbols.has(q.symbol));
  const gridKey = gridQuotes.map((q) => q.symbol).join(',');

  // Per-card sparklines: one finance.history({symbol, period:'1d'}) per grid
  // symbol, fetched together when the symbol set changes (and on manual
  // refresh). NOT re-pulled on every 30s grid poll — a ~24h sparkline barely
  // moves between ticks, so the prices/changes stay live while the lines
  // refresh on demand.
  const [histories, setHistories] = useState<Record<string, HistoryPoint[]>>({});

  const loadHistories = useCallback(async (symbols: string[]) => {
    const results = await Promise.allSettled(
      symbols.map((symbol) => window.aether.mesh.invoke('finance.history', { symbol, period: '1d' })),
    );
    const next: Record<string, HistoryPoint[]> = {};
    results.forEach((res, i) => {
      const symbol = symbols[i];
      if (!symbol) return;
      if (res.status === 'fulfilled' && res.value.ok && res.value.envelope) {
        const payload = res.value.envelope.payload as unknown as HistoryPayload;
        next[symbol] = Array.isArray(payload.points) ? payload.points : [];
      }
    });
    setHistories((prev) => ({ ...prev, ...next }));
  }, []);

  useEffect(() => {
    if (!gridKey) return;
    void loadHistories(gridKey.split(','));
  }, [gridKey, loadHistories]);

  const refreshAll = () => {
    grid.refetch();
    movers.refetch();
    sectors.refetch();
    if (gridKey) void loadHistories(gridKey.split(','));
  };

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

      {offline && (
        <p className="text-xs text-amber-300 px-4 py-1.5 border-b border-[var(--holo-border)]">
          Live fetch failing ({grid.error}) — showing last quotes{asOf ? ` as of ${asOf}` : ''}
        </p>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
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

        {gridQuotes.length > 0 && (
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            {gridQuotes.map((q) => (
              <QuoteCard key={q.symbol} quote={q} points={histories[q.symbol] ?? []} />
            ))}
          </div>
        )}

        {(gainers.length > 0 || losers.length > 0) && (
          <section>
            <h2 className="text-xs font-medium text-[var(--holo-muted)] uppercase tracking-wider mb-1.5 px-1">
              Movers
            </h2>
            <div
              className="grid gap-3 rounded-lg border p-3"
              style={{
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                borderColor: 'var(--holo-border)',
                background: 'var(--holo-panel)',
              }}
            >
              <div>
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider mb-1" style={{ color: UP }}>
                  <TrendingUp size={11} /> Gainers
                </div>
                {gainers.map((q) => (
                  <MoverRow key={q.symbol} quote={q} />
                ))}
              </div>
              <div>
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider mb-1" style={{ color: DOWN }}>
                  <TrendingDown size={11} /> Losers
                </div>
                {losers.map((q) => (
                  <MoverRow key={q.symbol} quote={q} />
                ))}
              </div>
            </div>
          </section>
        )}

        {sectorList.length > 0 && (
          <section>
            <h2 className="text-xs font-medium text-[var(--holo-muted)] uppercase tracking-wider mb-1.5 px-1">
              Sectors
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {sectorList.map((s) => (
                <div
                  key={s.symbol}
                  className="rounded-md border px-2 py-1 flex items-center gap-1.5"
                  style={{ borderColor: 'var(--holo-border)', background: 'var(--holo-panel)' }}
                  title={s.name}
                >
                  <span className="text-[11px] font-medium">{s.name}</span>
                  <span
                    className="text-[11px]"
                    style={{ color: tone(s.change_percent), fontVariantNumeric: 'tabular-nums' }}
                  >
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
