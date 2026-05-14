import { useCallback, useEffect, useState } from 'react'
import type { MeshInvokeResult } from '../../../electron/preload'

// Article shape mirrors the news_feeds.recent surface output. The node
// owns the canonical types at nodes/news_feeds/src/parser.ts and
// nodes/news_feeds/src/types.ts; we duplicate here rather than reach
// into a workspace package because the renderer bundle should not
// depend on Node-only mesh-node-sdk code paths.
type Category = 'world' | 'us' | 'tech' | 'business' | 'sports' | 'science' | 'local'

// Order mirrors nodes/news_feeds/src/types.ts CATEGORIES — broad scope
// → specific. The chip row, the JSON Schema enum, and the voice prompt
// enumeration all use the same sequence; keep them in sync.
const CATEGORIES: readonly Category[] = [
  'world',
  'us',
  'tech',
  'business',
  'sports',
  'science',
  'local'
] as const

const CATEGORY_LABELS: Record<Category, string> = {
  world: 'World',
  us: 'US',
  tech: 'Tech',
  business: 'Business',
  sports: 'Sports',
  science: 'Science',
  local: 'Local'
}

interface Article {
  id: string
  feed: string
  category: Category
  title: string
  summary: string
  url: string
  published_at: string
  fetched_at: string
}

// 'all' is a UI-only sentinel meaning "no category filter — call
// news_feeds.recent without a category field". It is never sent to the
// mesh; the handler treats absent and 'all' identically.
type Filter = Category | 'all'

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

  const categoryLabel = CATEGORY_LABELS[article.category]

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
        <div className="flex items-center gap-2 flex-wrap">
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
          {categoryLabel && (
            <span
              className="text-[10px] uppercase tracking-[0.18em] px-1.5 py-0.5 rounded"
              style={{
                color: 'var(--holo-muted)',
                borderColor: 'var(--holo-border)',
                background: 'rgba(255,255,255,0.03)'
              }}
            >
              {categoryLabel}
            </span>
          )}
        </div>
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

function EmptyState({
  filter,
  onRetry
}: {
  filter: Filter
  onRetry: () => void
}) {
  const filtered = filter !== 'all'
  return (
    <div
      className="holo-card rounded-2xl border px-5 py-4 flex flex-col gap-3"
      style={{
        background: 'rgba(15,15,25,0.5)',
        borderColor: 'var(--holo-border)'
      }}
    >
      <div className="text-sm" style={{ color: 'var(--holo-muted)' }}>
        {filtered
          ? `No recent articles in ${CATEGORY_LABELS[filter]}.`
          : 'Headlines refreshing — give it a moment.'}
      </div>
      <div className="text-[11px]" style={{ color: 'var(--holo-muted)' }}>
        {filtered
          ? 'Try another category, or wait for the next poll. The news_feeds node polls every 15 minutes.'
          : 'The news_feeds node polls every 15 minutes. The first poll completes a few seconds after the shell starts.'}
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

function CategoryChip({
  label,
  selected,
  onClick
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="text-xs px-3 py-1.5 rounded-full border transition-colors"
      style={
        selected
          ? {
              color: 'var(--holo-accent)',
              borderColor: 'rgba(74,158,255,0.65)',
              background: 'rgba(74,158,255,0.14)'
            }
          : {
              color: 'var(--holo-muted)',
              borderColor: 'var(--holo-border)',
              background: 'rgba(15,15,25,0.5)'
            }
      }
    >
      {label}
    </button>
  )
}

function CategoryRow({
  filter,
  onChange
}: {
  filter: Filter
  onChange: (next: Filter) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <CategoryChip label="All" selected={filter === 'all'} onClick={() => onChange('all')} />
      {CATEGORIES.map((c) => (
        <CategoryChip
          key={c}
          label={CATEGORY_LABELS[c]}
          selected={filter === c}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  )
}

export function News() {
  const [filter, setFilter] = useState<Filter>('all')
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const load = useCallback(async (current: Filter): Promise<void> => {
    setState({ kind: 'loading' })
    const payload: { limit: number; category?: Category } = { limit: RECENT_LIMIT }
    if (current !== 'all') payload.category = current
    let result: MeshInvokeResult
    try {
      result = await window.homeOS.mesh.invoke('news_feeds.recent', payload)
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
    const responsePayload = result.envelope.payload as { articles?: unknown }
    const articles = Array.isArray(responsePayload.articles)
      ? (responsePayload.articles as Article[])
      : []
    setState({ kind: 'ok', articles, fetchedAt: new Date().toISOString() })
  }, [])

  useEffect(() => {
    void load(filter)
  }, [load, filter])

  const onPickFilter = useCallback((next: Filter) => {
    // setFilter triggers the effect above, which kicks off the mesh
    // invoke. Don't call load() directly here — that would race the
    // state update and we'd send the old filter.
    setFilter(next)
  }, [])

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 flex flex-col gap-4">
        <CategoryRow filter={filter} onChange={onPickFilter} />
        {state.kind === 'loading' && <LoadingState />}
        {state.kind === 'error' && (
          <ErrorState message={state.message} onRetry={() => void load(filter)} />
        )}
        {state.kind === 'ok' && state.articles.length === 0 && (
          <EmptyState filter={filter} onRetry={() => void load(filter)} />
        )}
        {state.kind === 'ok' &&
          state.articles.length > 0 &&
          state.articles.map((a) => <ArticleCard key={a.id} article={a} />)}
      </div>
    </div>
  )
}
