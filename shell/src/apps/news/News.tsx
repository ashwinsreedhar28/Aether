import { ARTICLES, type Article, type ArticleCategory, type ArticleUrgency } from './articles'

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const minutes = Math.round(diff / 60_000)
  const hours = Math.round(minutes / 60)
  const days = Math.round(hours / 24)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

const CATEGORY_COLOR: Record<ArticleCategory, string> = {
  finance: 'rgb(255, 178, 60)',
  tech: 'rgb(100, 180, 255)',
  sports: 'rgb(60, 210, 140)',
  world: 'rgb(180, 130, 255)'
}

const URGENCY_COLOR: Record<ArticleUrgency, string> = {
  high: 'rgb(255, 105, 105)',
  medium: 'rgb(255, 175, 80)',
  low: 'var(--holo-muted)'
}

function ArticleCard({ article }: { article: Article }) {
  const categoryColor = CATEGORY_COLOR[article.category]
  const urgencyColor = URGENCY_COLOR[article.urgency]
  return (
    <article
      className="holo-card rounded-2xl border px-5 py-4"
      style={{
        background: 'rgba(15,15,25,0.5)',
        borderColor: 'var(--holo-border)'
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium px-2 py-0.5 rounded border"
          style={{
            color: categoryColor,
            borderColor: `${categoryColor}55`,
            background: `${categoryColor}10`
          }}
        >
          {article.source}
        </span>
        <span
          aria-label={`${article.urgency} urgency`}
          className="w-2 h-2 rounded-full shrink-0 mt-1.5"
          style={{ background: urgencyColor }}
        />
      </div>
      <h3
        className="text-lg font-medium leading-snug mb-2"
        style={{ color: 'var(--holo-text)' }}
      >
        {article.headline}
      </h3>
      <p
        className="text-sm leading-relaxed"
        style={{ color: 'var(--holo-muted)' }}
      >
        {article.summary}
      </p>
      <div
        className="text-[11px] mt-3"
        style={{ color: 'var(--holo-muted)' }}
      >
        {relativeTime(article.publishedAt)}
      </div>
    </article>
  )
}

export function News() {
  if (ARTICLES.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="text-sm" style={{ color: 'var(--holo-muted)' }}>
          No articles yet.
        </div>
      </div>
    )
  }
  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 flex flex-col gap-4">
        {ARTICLES.map((a) => (
          <ArticleCard key={a.id} article={a} />
        ))}
      </div>
    </div>
  )
}
