import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, TrendingDown, TrendingUp } from 'lucide-react';
import { useMeshSurface } from '../../hooks/useMeshSurface';
import {
  DOWN,
  UP,
  fmtChange,
  fmtMarketCap,
  fmtPct,
  fmtPrice,
  fmtRatio,
  fmtVolume,
  tone,
} from './format';

// Per-ticker detail page (#354). Opens from a grid card. Header reads the
// live quote (finance.quote, enriched with name/sector + basic stats); the
// chart reads finance.chart — a LIVE upstream Yahoo fetch (distinct from the
// passive-accumulation finance.history that backs the grid sparkline) so the
// 1D/5D/1M/3M/1Y spans actually work on a fresh install and beyond the 90-day
// retention window. See DECISIONS "finance.chart upstream fetch".

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
  open?: number;
  day_high?: number;
  day_low?: number;
  pe_ratio?: number;
  market_cap?: number;
  fifty_two_week_high?: number;
  fifty_two_week_low?: number;
}
interface QuotePayload {
  quote: Quote;
}

interface ChartPoint {
  t: string;
  close: number;
  volume: number;
}
interface ChartPayload {
  symbol: string;
  range: string;
  points: ChartPoint[];
}

// Spans, shortest → longest (mirrors CHART_RANGES in nodes/finance/src/types.ts
// and the chart.json enum — one reading order across the stack).
const RANGES = ['1D', '5D', '1M', '3M', '1Y'] as const;
type Range = (typeof RANGES)[number];

const CHART_MIN = 2;

/**
 * Full-width price line chart over a fetched close series. Normalised to the
 * box, stroked in the move's tone, with a faint area fill and min/max guide
 * labels. Renders an empty state below CHART_MIN points.
 */
function LineChart({ points, color }: { points: ChartPoint[]; color: string }) {
  const w = 560;
  const h = 180;
  const padX = 6;
  const padY = 10;
  if (points.length < CHART_MIN) {
    return (
      <div
        className="flex items-center justify-center text-xs text-[var(--holo-muted)]"
        style={{ width: '100%', height: h }}
      >
        No chart data for this span.
      </div>
    );
  }
  const prices = points.map((p) => p.close);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const stepX = (w - padX * 2) / (points.length - 1);
  const toXY = (p: ChartPoint, i: number): [number, number] => {
    const x = padX + i * stepX;
    const y = padY + (1 - (p.close - min) / span) * (h - padY * 2);
    return [x, y];
  };
  const line = points
    .map((p, i) => {
      const [x, y] = toXY(p, i);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const [, firstY] = toXY(points[0]!, 0);
  const [lastX] = toXY(points[points.length - 1]!, points.length - 1);
  const area = `${line} L${lastX.toFixed(1)},${(h - padY).toFixed(1)} L${padX.toFixed(
    1,
  )},${(h - padY).toFixed(1)} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: h, display: 'block' }}
      aria-hidden="true"
    >
      <path d={area} fill={color} opacity={0.08} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <line x1={padX} y1={firstY} x2={w - padX} y2={firstY} stroke="var(--holo-border)" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.4} />
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-[var(--holo-muted)]">{label}</span>
      <span className="text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}

export function StockDetail({ symbol, onBack }: { symbol: string; onBack: () => void }) {
  const quoteState = useMeshSurface<QuotePayload>('finance.quote', { symbol }, {
    pollMs: 30000,
    cacheKey: `stock-detail-quote-${symbol}`,
  });
  const quote = quoteState.data?.quote;

  const [range, setRange] = useState<Range>('1M');
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);

  const loadChart = useCallback(
    async (r: Range) => {
      setChartLoading(true);
      setChartError(null);
      try {
        const res = await window.aether.mesh.invoke('finance.chart', { symbol, range: r });
        if (res.ok && res.envelope) {
          const payload = res.envelope.payload as unknown as ChartPayload;
          setPoints(Array.isArray(payload.points) ? payload.points : []);
        } else {
          setChartError(res.error?.message ?? 'chart unavailable');
          setPoints([]);
        }
      } catch (e) {
        setChartError(e instanceof Error ? e.message : 'chart unavailable');
        setPoints([]);
      } finally {
        setChartLoading(false);
      }
    },
    [symbol],
  );

  useEffect(() => {
    void loadChart(range);
  }, [range, loadChart]);

  const pct = quote?.change_percent ?? 0;
  const color = tone(pct);
  const up = pct > 0;
  const down = pct < 0;

  const dayRange =
    quote && typeof quote.day_low === 'number' && typeof quote.day_high === 'number'
      ? `${fmtPrice(quote.day_low)} – ${fmtPrice(quote.day_high)}`
      : '—';
  const weekRange =
    quote &&
    typeof quote.fifty_two_week_low === 'number' &&
    typeof quote.fifty_two_week_high === 'number'
      ? `${fmtPrice(quote.fifty_two_week_low)} – ${fmtPrice(quote.fifty_two_week_high)}`
      : '—';

  return (
    <div className="w-full h-full flex flex-col bg-[var(--holo-bg)] text-[var(--holo-text)]">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-[var(--holo-border)]">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[var(--holo-muted)] hover:text-[var(--holo-accent)] transition-colors"
          title="Back to all stocks"
        >
          <ArrowLeft size={16} />
          <span className="text-xs">All stocks</span>
        </button>
        <div className="ml-auto text-right min-w-0">
          <div className="text-sm font-semibold tracking-wide truncate">{symbol}</div>
          {quote?.name && (
            <div className="text-[11px] text-[var(--holo-muted)] truncate" title={quote.name}>
              {quote.name}
              {quote.sector ? ` · ${quote.sector}` : ''}
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {quoteState.loading && !quote && (
          <p className="text-sm text-[var(--holo-muted)]">Reading the quote…</p>
        )}
        {quoteState.error && !quote && (
          <p className="text-sm text-amber-300">{quoteState.error}</p>
        )}

        {quote && (
          <div className="flex items-end justify-between gap-3">
            <div className="text-3xl font-medium" style={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              {fmtPrice(quote.price)}
            </div>
            <div className="text-right flex flex-col items-end" style={{ color }}>
              <span className="flex items-center gap-1 text-base font-medium" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {up && <TrendingUp size={16} />}
                {down && <TrendingDown size={16} />}
                {fmtPct(quote.change_percent)}
              </span>
              <span className="text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {fmtChange(quote.change)}
              </span>
            </div>
          </div>
        )}

        {/* Range toggle */}
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="px-2.5 py-1 rounded-md text-xs transition-colors border"
              style={{
                borderColor: r === range ? 'var(--holo-accent)' : 'var(--holo-border)',
                color: r === range ? 'var(--holo-accent)' : 'var(--holo-muted)',
                background: r === range ? 'var(--holo-panel)' : 'transparent',
              }}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Chart */}
        <div
          className="rounded-lg border p-2"
          style={{ borderColor: 'var(--holo-border)', background: 'var(--holo-panel)' }}
        >
          {chartLoading && points.length === 0 ? (
            <div className="flex items-center justify-center text-xs text-[var(--holo-muted)]" style={{ height: 180 }}>
              Loading {range} chart…
            </div>
          ) : chartError && points.length === 0 ? (
            <div className="flex items-center justify-center text-xs text-amber-300" style={{ height: 180 }}>
              {chartError}
            </div>
          ) : (
            <LineChart points={points} color={up ? UP : down ? DOWN : 'var(--holo-accent)'} />
          )}
        </div>

        {/* Stats */}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <Stat label="P/E" value={fmtRatio(quote?.pe_ratio)} />
          <Stat label="Mkt Cap" value={fmtMarketCap(quote?.market_cap)} />
          <Stat label="Volume" value={fmtVolume(quote?.volume)} />
          <Stat label="Open" value={typeof quote?.open === 'number' ? fmtPrice(quote.open) : '—'} />
          <Stat label="Day Range" value={dayRange} />
          <Stat label="52-Wk Range" value={weekRange} />
        </div>
      </div>
    </div>
  );
}
