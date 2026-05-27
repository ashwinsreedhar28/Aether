import { useCallback, useEffect, useState } from 'react'
import type { MeshInvokeResult } from '../../../electron/preload'

// Quote shape mirrors the finance.market_summary surface output. Canonical
// type lives in nodes/finance/src/types.ts; duplicated here so the renderer
// bundle doesn't pull Node-only mesh-node-sdk paths. Keep in sync with the
// node's types.ts and DECISIONS.md "Second data node" ADR.
interface Quote {
  symbol: string
  price: number
  change: number
  change_percent: number
  volume: number
  latest_trading_day: string
  fetched_at: string
}

// HistoryPoint mirrors the finance.history surface output. Same
// duplication rationale as Quote — keep in sync with
// nodes/finance/src/history.ts.
interface HistoryPoint {
  fetched_at: string
  price: number
  change_percent: number
}

type HistoryMap = Record<string, HistoryPoint[]>

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; quotes: Quote[]; fetchedAt: string; history: HistoryMap }
  // 'throttled' is the special-case rate_limited reason — surfaced with
  // a "temporarily throttled, retry shortly" copy instead of "finance
  // unavailable". A confused-by-rare-event user reads the throttled
  // message as "this will sort itself out" rather than "something is
  // broken". Everything else collapses into the generic error path.
  | { kind: 'throttled' }
  | { kind: 'error'; message: string }

// Minimum sample count before the sparkline renders. Below this the
// shape would be noise (two points = a straight line, one = a dot);
// the QuoteCard quietly omits the row instead. A fresh install hits
// 3 samples within ~15 minutes of node launch.
const SPARKLINE_MIN_POINTS = 3
const SPARKLINE_W = 80
const SPARKLINE_H = 24

// 60s. Most ticks hit the node's in-memory cache (poller refreshes every
// 5min). The render-side refresh is what surfaces fresh prices when the
// poller's writes land — there is no push channel from finance →
// renderer in v1, so polling here is the cheap way to keep the grid
// current. Network cost is one mesh.invoke per minute, which the node
// answers from RAM.
const REFRESH_INTERVAL_MS = 60_000

function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatChangePercent(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

// Compact share-count rendering — 12.3M / 1.2B beats "12,348,201" in a
// dense card. Zero (the no-volume sentinel from the upstream) collapses
// to "—" rather than "0" so it reads as missing data, not a flatline.
function formatVolume(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

// Linear point-to-point path. No smoothing, no fill — the card is small
// (80×24) and a poly-line reads cleanly at that size; bezier or area-fill
// would burn pixels on visual noise.
function Sparkline({
  points,
  stroke,
}: {
  points: HistoryPoint[]
  stroke: string
}) {
  if (points.length < SPARKLINE_MIN_POINTS) return null
  const prices = points.map((p) => p.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min
  // Flat series (range === 0) would divide-by-zero; centre the line
  // vertically instead. Rare but possible for low-volume tickers.
  const stride = SPARKLINE_W / (points.length - 1)
  const d = points
    .map((p, i) => {
      const x = i * stride
      const y =
        range === 0
          ? SPARKLINE_H / 2
          : SPARKLINE_H - ((p.price - min) / range) * SPARKLINE_H
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
  return (
    <svg
      width={SPARKLINE_W}
      height={SPARKLINE_H}
      viewBox={`0 0 ${SPARKLINE_W} ${SPARKLINE_H}`}
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function QuoteCard({
  quote,
  history,
}: {
  quote: Quote
  history: HistoryPoint[] | undefined
}) {
  const positive = quote.change >= 0
  // Direction is communicated by both shape (▲/▼) and colour — colour-only
  // would fail accessibility checks. The arrows are unicode glyphs (not
  // SVG / lucide) so no extra icon import.
  const arrow = positive ? '▲' : '▼'
  const changeColor = positive ? 'rgb(110, 220, 150)' : 'rgb(255, 138, 138)'
  const accentBorder = positive ? 'rgba(110,220,150,0.35)' : 'rgba(255,138,138,0.40)'

  return (
    <div
      className="holo-card rounded-2xl border px-4 py-4 flex flex-col gap-2"
      style={{
        background: 'rgba(15,15,25,0.5)',
        borderColor: accentBorder,
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="text-base font-semibold tracking-wide"
          style={{ color: 'var(--holo-text)' }}
        >
          {quote.symbol}
        </span>
        <span
          className="text-[10px] uppercase tracking-[0.18em]"
          style={{ color: 'var(--holo-muted)' }}
        >
          {quote.latest_trading_day || '—'}
        </span>
      </div>
      <div
        className="text-2xl font-light tabular-nums"
        style={{ color: 'var(--holo-text)' }}
      >
        ${formatPrice(quote.price)}
      </div>
      <div
        className="flex items-center gap-2 text-sm tabular-nums"
        style={{ color: changeColor }}
      >
        <span aria-hidden="true">{arrow}</span>
        <span>{formatChangePercent(quote.change_percent)}</span>
        <span style={{ color: 'var(--holo-muted)' }} className="text-xs">
          ({positive ? '+' : ''}
          {formatPrice(quote.change)})
        </span>
      </div>
      <div
        className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em]"
        style={{ color: 'var(--holo-muted)' }}
      >
        <span>Volume</span>
        <span className="tabular-nums">{formatVolume(quote.volume)}</span>
      </div>
      {history && history.length >= SPARKLINE_MIN_POINTS && (
        <Sparkline points={history} stroke={changeColor} />
      )}
    </div>
  )
}

function LoadingState() {
  // Static muted block — no infinite CSS animation, per CLAUDE.md §10.
  return (
    <div
      className="holo-card rounded-2xl border px-5 py-4"
      style={{
        background: 'rgba(15,15,25,0.5)',
        borderColor: 'var(--holo-border)',
        opacity: 0.75,
      }}
    >
      <div className="text-sm" style={{ color: 'var(--holo-muted)' }}>
        Fetching quotes…
      </div>
    </div>
  )
}

function ThrottledState({ onRetry }: { onRetry: () => void }) {
  // Holographic-amber treatment to distinguish "temporary, will recover"
  // from "something is broken" (which gets the red ErrorState below).
  // No mono error text — the throttle is the message, no upstream detail
  // would help the user.
  return (
    <div
      className="holo-card rounded-2xl border px-5 py-4 flex flex-col gap-3"
      style={{
        background: 'rgba(40,28,12,0.55)',
        borderColor: 'rgba(255,200,105,0.45)',
      }}
    >
      <div className="text-sm" style={{ color: 'rgb(255, 210, 138)' }}>
        Finance temporarily throttled — quotes refreshing later.
      </div>
      <div
        className="text-[11px] leading-relaxed"
        style={{ color: 'rgba(255,210,138,0.75)' }}
      >
        The upstream API is over its rate limit. The finance node will
        retry on its next 5-minute cycle; press Retry to try sooner.
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="self-start text-xs px-3 py-1.5 rounded-md border transition-colors"
        style={{
          color: 'var(--holo-accent)',
          borderColor: 'rgba(74,158,255,0.45)',
          background: 'rgba(74,158,255,0.10)',
        }}
      >
        Retry
      </button>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="holo-card rounded-2xl border px-5 py-4 flex flex-col gap-3"
      style={{
        background: 'rgba(40,12,12,0.6)',
        borderColor: 'rgba(255,105,105,0.45)',
      }}
    >
      <div className="text-sm" style={{ color: 'rgb(255, 138, 138)' }}>
        Finance unavailable.
      </div>
      <div
        className="text-[11px] font-mono leading-relaxed"
        style={{ color: 'rgba(255,138,138,0.75)' }}
      >
        {message}
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="self-start text-xs px-3 py-1.5 rounded-md border transition-colors"
        style={{
          color: 'var(--holo-accent)',
          borderColor: 'rgba(74,158,255,0.45)',
          background: 'rgba(74,158,255,0.10)',
        }}
      >
        Retry
      </button>
    </div>
  )
}

function EmptyState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="holo-card rounded-2xl border px-5 py-4 flex flex-col gap-3"
      style={{
        background: 'rgba(15,15,25,0.5)',
        borderColor: 'var(--holo-border)',
      }}
    >
      <div className="text-sm" style={{ color: 'var(--holo-muted)' }}>
        Quotes refreshing — give it a moment.
      </div>
      <div className="text-[11px]" style={{ color: 'var(--holo-muted)' }}>
        The finance node polls every 5 minutes. First cycle staggers one
        ticker every 30 seconds, so the full grid populates over the
        first few minutes after the shell starts.
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="self-start text-xs px-3 py-1.5 rounded-md border transition-colors"
        style={{
          color: 'var(--holo-accent)',
          borderColor: 'rgba(74,158,255,0.45)',
          background: 'rgba(74,158,255,0.10)',
        }}
      >
        Refresh
      </button>
    </div>
  )
}

function bySymbolAsc(a: Quote, b: Quote): number {
  return a.symbol.localeCompare(b.symbol)
}

// Best-effort parallel fetch of last-24h history per symbol for the
// in-card sparkline. The finance.history surface reads from local
// SQLite (no upstream call, no rate-limit risk), so 10 parallel
// invocations cost only the IPC round-trips. allSettled keeps a single
// failing symbol from poisoning the whole map — failed lookups just
// mean that card renders without a sparkline.
async function fetchHistoryMap(symbols: string[]): Promise<HistoryMap> {
  const out: HistoryMap = {}
  if (symbols.length === 0) return out
  const results = await Promise.allSettled(
    symbols.map((sym) =>
      window.aether.mesh.invoke('finance.history', {
        symbol: sym,
        period: '1d',
      }),
    ),
  )
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return
    const sym = symbols[i]
    if (!sym) return
    const inv = r.value
    if (!inv.ok || !inv.envelope) return
    const payload = inv.envelope.payload as { points?: unknown }
    if (Array.isArray(payload.points)) {
      out[sym] = payload.points as HistoryPoint[]
    }
  })
  return out
}

export function Finance() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const load = useCallback(async (): Promise<void> => {
    let result: MeshInvokeResult
    try {
      result = await window.aether.mesh.invoke('finance.market_summary', {})
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message ?? 'IPC failed' })
      return
    }
    if (!result.ok || !result.envelope) {
      // Rate-limit is the one case worth distinguishing: it is temporary
      // and the user shouldn't read it as "finance is broken." Reason
      // comes through as the message field (MeshDeny reason mapped by
      // shell/electron/main/services/mesh.ts). Everything else collapses
      // into the generic error path.
      if (result.error?.message === 'finance_rate_limited') {
        setState({ kind: 'throttled' })
        return
      }
      setState({
        kind: 'error',
        message: result.error?.message ?? 'mesh invoke returned no envelope',
      })
      return
    }
    const payload = result.envelope.payload as { quotes?: unknown }
    const quotes = Array.isArray(payload.quotes) ? (payload.quotes as Quote[]) : []
    // Sort by symbol for stable cell positions across refreshes. Without
    // this the Map iteration order in the node would carry through and
    // cells could appear to swap positions on each refresh.
    quotes.sort(bySymbolAsc)
    // Fetch sparkline data AFTER the quotes land so the grid renders
    // immediately with the prices and the sparklines fill in once the
    // history calls complete. Both legs use the same node, so the
    // history reads usually return within a tick or two of the
    // market_summary read; the perceived delay is invisible.
    const history = await fetchHistoryMap(quotes.map((q) => q.symbol))
    setState({
      kind: 'ok',
      quotes,
      fetchedAt: new Date().toISOString(),
      history,
    })
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => {
      void load()
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [load])

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-4">
        {state.kind === 'loading' && <LoadingState />}
        {state.kind === 'throttled' && <ThrottledState onRetry={() => void load()} />}
        {state.kind === 'error' && (
          <ErrorState message={state.message} onRetry={() => void load()} />
        )}
        {state.kind === 'ok' && state.quotes.length === 0 && (
          <EmptyState onRetry={() => void load()} />
        )}
        {state.kind === 'ok' && state.quotes.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {state.quotes.map((q) => (
              <QuoteCard
                key={q.symbol}
                quote={q}
                history={state.history[q.symbol]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
