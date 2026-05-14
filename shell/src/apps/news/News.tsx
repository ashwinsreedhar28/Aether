import { useCallback, useEffect, useState } from 'react'
import type { MeshInvokeResult } from '../../../electron/preload'

// Article shape mirrors the news_feeds.recent surface output. The node
// owns the canonical type at nodes/news_feeds/src/parser.ts; we duplicate
// here rather than reach into a workspace package because the renderer
// bundle should not depend on Node-only mesh-node-sdk code paths.
interface Article {
  id: string
  feed: string
  title: string
  summary: string
  url: string
  published_at: string
  fetched_at: string
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; articles: Article[]; fetchedAt: string }
  | { kind: 'error'; message: string }

const RECENT_LIMIT = 20

// Compact relative-time formatter. Long-form date-fns would be overkill
// here — six branches cover everything from "just now" to "May 13".
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffMs = Date.now() - then
  if (diffMs < 0) return 'just now'
  const minutes = Math.round(diffMs / 60_000)
  const hours = Math.round(diffMs / 3_600_000)
  const days = Math.round(diffMs / 86_400_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function ArticleCard({ article }: { article: Article }) {
  const openInBrowser = useCallback(() => {
    void window.homeOS.shell.openExternal(article.url)
  }, [article.url])

  return (
    <article
      className="holo-card rounded-2xl border px-5 py-4 cursor-pointer transition-colors hover:border-opacity-100"
      onClick={openInBrowser}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openInBrowser()
        }
      }}
      role="button"
      tabIndex={0}
      style={{
        background: 'rgba(15,15,25,0.5)',
        borderColor: 'var(--holo-border)'
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium px-2 py-0.5 rounded border"
          style={{
            color: 'var(--holo-accent)',
            borderColor: 'rgba(74,158,255,0.35)',
            background: 'rgba(74,158,255,0.08)'
          }}
        >
          {article.feed}
        </span>
        <span className="text-[10px] shrink-0 mt-1" style={{ color: 'var(--holo-muted)' }}>
          {relativeTime(article.published_at)}
        </span>
      </div>
      <h3
        className="text-lg font-medium leading-snug mb-2"
        style={{ color: 'var(--holo-text)' }}
      >
        {article.title}
      </h3>
      {article.summary && (
        <p
          className="text-sm leading-relaxed"
          style={{ color: 'var(--holo-muted)' }}
        >
          {article.summary}
        </p>
      )}
    </article>
  )
}

function LoadingState() {
  // No CSS animation here per CLAUDE.md §10 — permanent `infinite`
  // animations jitter under macOS screen-sharing, and rAF-driven pulses
  // are overkill for a sub-second state. The dim muted colour reads as
  // "in progress" without motion.
  return (
    <div
      className="holo-card rounded-2xl border px-5 py-4"
      style={{
        background: 'rgba(15,15,25,0.5)',
        borderColor: 'var(--holo-border)',
        opacity: 0.75
      }}
    >
      <div className="text-sm" style={{ color: 'var(--holo-muted)' }}>
        Fetching headlines…
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="holo-card rounded-2xl border px-5 py-4 flex flex-col gap-3"
      style={{
        background: 'rgba(40,12,12,0.6)',
        borderColor: 'rgba(255,105,105,0.45)'
      }}
    >
      <div className="text-sm" style={{ color: 'rgb(255, 138, 138)' }}>
        News feed unavailable.
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
          background: 'rgba(74,158,255,0.10)'
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
        borderColor: 'var(--holo-border)'
      }}
    >
      <div className="text-sm" style={{ color: 'var(--holo-muted)' }}>
        Headlines refreshing — give it a moment.
      </div>
      <div className="text-[11px]" style={{ color: 'var(--holo-muted)' }}>
        The news_feeds node polls every 15 minutes. The first poll completes a
        few seconds after the shell starts.
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="self-start text-xs px-3 py-1.5 rounded-md border transition-colors"
        style={{
          color: 'var(--holo-accent)',
          borderColor: 'rgba(74,158,255,0.45)',
          background: 'rgba(74,158,255,0.10)'
        }}
      >
        Refresh
      </button>
    </div>
  )
}

export function News() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' })
    let result: MeshInvokeResult
    try {
      result = await window.homeOS.mesh.invoke('news_feeds.recent', { limit: RECENT_LIMIT })
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message ?? 'IPC failed' })
      return
    }
    if (!result.ok || !result.envelope) {
      setState({
        kind: 'error',
        message: result.error?.message ?? 'mesh invoke returned no envelope'
      })
      return
    }
    const payload = result.envelope.payload as { articles?: unknown }
    const articles = Array.isArray(payload.articles) ? (payload.articles as Article[]) : []
    setState({ kind: 'ok', articles, fetchedAt: new Date().toISOString() })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 flex flex-col gap-4">
        {state.kind === 'loading' && <LoadingState />}
        {state.kind === 'error' && (
          <ErrorState message={state.message} onRetry={() => void load()} />
        )}
        {state.kind === 'ok' && state.articles.length === 0 && (
          <EmptyState onRetry={() => void load()} />
        )}
        {state.kind === 'ok' &&
          state.articles.length > 0 &&
          state.articles.map((a) => <ArticleCard key={a.id} article={a} />)}
      </div>
    </div>
  )
}
