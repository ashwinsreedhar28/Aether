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
  latest_trading_day: string
  fetched_at: string
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; quotes: Quote[]; fetchedAt: string }
  // 'throttled' is the special-case rate_limited reason — surfaced with
  // a "temporarily throttled, retry shortly" copy instead of "finance
  // unavailable". A confused-by-rare-event user reads the throttled
  // message as "this will sort itself out" rather than "something is
  // broken". Everything else collapses into the generic error path.
  | { kind: 'throttled' }
  | { kind: 'error'; message: string }

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

function QuoteCard({ quote }: { quote: Quote }) {
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

export function Finance() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const load = useCallback(async (): Promise<void> => {
    let result: MeshInvokeResult
    try {
      result = await window.homeOS.mesh.invoke('finance.market_summary', {})
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
    setState({ kind: 'ok', quotes, fetchedAt: new Date().toISOString() })
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
              <QuoteCard key={q.symbol} quote={q} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
