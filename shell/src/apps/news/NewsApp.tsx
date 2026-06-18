import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Newspaper, RefreshCw, Zap } from 'lucide-react';
import { useMeshSurface } from '../../hooks/useMeshSurface';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { app as browserApp } from '../browser';

// The news vertical's face. Wave 1 of the Pulse-vertical program (#344),
// mirroring music Lane B (#335): a display MeshApp over the existing
// news_feeds Sensor. Reads are read-only (news_feeds is a Sensor, no Actor
// calls); the node polls its feeds on its own cadence, so the 60s renderer
// poll is largely a cache read. Category chips re-invoke recent with a
// category filter; the Breaking toggle swaps the read to news_feeds.breaking
// (high-urgency only). Clicking a row opens its url in the in-app browser,
// the same openWindow path the Gaps / Lanes boards use for click-through.

// Mirror of nodes/news_feeds/src/types.ts (Category / CATEGORIES / Urgency) —
// inlined rather than imported, the way MusicApp inlines its now-playing
// types, to keep the shell from reaching across into a node package. Source
// of truth lives in that file; keep the order (semantic: broad → specific)
// and the urgency intensity ordering in sync if it changes there.
type Category = 'world' | 'us' | 'tech' | 'business' | 'sports' | 'science' | 'local';
const CATEGORIES: readonly Category[] = [
  'world',
  'us',
  'tech',
  'business',
  'sports',
  'science',
  'local',
] as const;
const CATEGORY_LABELS: Record<Category, string> = {
  world: 'World',
  us: 'US',
  tech: 'Tech',
  business: 'Business',
  sports: 'Sports',
  science: 'Science',
  local: 'Local',
};

type Urgency = 'low' | 'medium' | 'high';

// Wire shape of one row from news_feeds.{recent,breaking} — the raw Article
// the surface returns under `{ articles }` (see nodes/news_feeds/src/index.ts
// makeRecentHandler / makeBreakingHandler and storage.ts recent()/breaking()).
// `feed` is the source name; entities are NOT attached on these surfaces
// (entity drill-down is a later wave).
interface NewsArticle {
  id: string;
  feed: string;
  category: Category;
  urgency: Urgency;
  urgency_reason: string;
  title: string;
  summary: string;
  url: string;
  published_at: string;
  fetched_at: string;
}
interface NewsPayload {
  articles: NewsArticle[];
}

/** Relative "12m ago" from an ISO timestamp — same buckets as the Gaps /
 * Lanes boards, adapted to parse an ISO string instead of epoch ms. */
function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Urgency badge palette — grey / amber / red ascending with the intensity
// scale (low → medium → high), the mapping called out in types.ts.
const URGENCY_BADGE: Record<Urgency, string> = {
  low: 'border-[var(--holo-border)] text-[var(--holo-muted)]',
  medium: 'border-amber-400/50 bg-amber-400/10 text-amber-300',
  high: 'border-red-400/60 bg-red-400/15 text-red-300',
};

const CHIP_BASE =
  'text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap transition-colors';
const CHIP_ACTIVE = 'border-[var(--holo-accent)]/60 bg-[var(--holo-accent)]/20 text-[var(--holo-accent)]';
const CHIP_IDLE =
  'border-[var(--holo-border)] text-[var(--holo-muted)] hover:text-[var(--holo-text)]';
const BREAKING_ACTIVE = 'border-red-400/60 bg-red-400/15 text-red-300';

const CLAMP_2: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

function ArticleRow({ article, onOpen }: { article: NewsArticle; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left px-4 py-3 border-b border-[var(--holo-border)] hover:bg-white/[0.04] transition-colors"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={`${CHIP_BASE} ${URGENCY_BADGE[article.urgency]} uppercase tracking-wide`}
          style={{ fontSize: 9, paddingTop: 1, paddingBottom: 1 }}
          title={article.urgency_reason || undefined}
        >
          {article.urgency}
        </span>
        <span className="text-[11px] text-[var(--holo-muted)]">
          {CATEGORY_LABELS[article.category] ?? article.category}
        </span>
        <span className="ml-auto text-[11px] text-[var(--holo-muted)] whitespace-nowrap">
          {article.feed} · {relTime(article.published_at)}
        </span>
      </div>
      <h3
        className="text-sm font-medium leading-snug text-[var(--holo-text)]"
        title={article.title}
        style={CLAMP_2}
      >
        {article.title}
      </h3>
      {article.summary && (
        <p
          className="text-xs text-[var(--holo-muted)] leading-relaxed mt-1"
          style={CLAMP_2}
        >
          {article.summary}
        </p>
      )}
    </button>
  );
}

export function NewsApp() {
  const [category, setCategory] = useState<Category | null>(null);
  const [breaking, setBreaking] = useState(false);
  const openWindow = useWorkspaceStore((s) => s.openWindow);

  const target = breaking ? 'news_feeds.breaking' : 'news_feeds.recent';
  // Breaking is urgency-filtered across all categories — it ignores category,
  // so its payload is always {}. Recent passes the selected category (or {} for
  // all). useMemo keeps the literal stable so it isn't a fresh object each render.
  const payload = useMemo(
    () => (!breaking && category ? { category } : {}),
    [breaking, category],
  );

  const { data, error, loading, refreshing, refetch } = useMeshSurface<NewsPayload>(
    target,
    payload,
    {
      pollMs: 60_000,
      visibleOnly: true,
      // Distinct keys so a breaking fetch doesn't clobber the recent feed's
      // offline cache (and vice versa); the recent surface uses the spec's
      // 'news-recent' key.
      cacheKey: breaking ? 'news-breaking' : 'news-recent',
    },
  );

  // The hook refetches when `target` changes (the breaking toggle) but NOT when
  // only the payload changes — its effect deps are [target, pollMs, visibleOnly].
  // A category re-filter on the recent surface keeps the same target, so nudge a
  // refetch manually rather than waiting out the 60s poll. refetch is held in a
  // ref so the effect depends on `category` alone, not refetch's per-render id.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const firstFilter = useRef(true);
  useEffect(() => {
    if (firstFilter.current) {
      firstFilter.current = false;
      return;
    }
    refetchRef.current();
  }, [category]);

  const articles = data?.articles ?? [];
  // error with data still present = node unreachable but the hook is rendering
  // its last good fetch (in-memory or localStorage cache) — offline mode.
  const offline = error != null && data != null;

  const openArticle = (article: NewsArticle) => {
    openWindow({
      title: article.title,
      appId: 'browser',
      // Browser treats an http(s) filePath as its initial URL; filePath must be
      // truthy or the window materializes tabless (controlBridge gotcha).
      filePath: article.url,
      position: { x: 150 + Math.random() * 100, y: 80 + Math.random() * 100 },
      size: browserApp.defaultSize || { width: 1024, height: 768 },
      isMinimized: false,
      isMaximized: false,
    });
  };

  // Selecting a category also drops out of breaking mode — the two are one
  // visible filter axis to the user even though they hit different surfaces.
  const selectCategory = (next: Category | null) => {
    setBreaking(false);
    setCategory(next);
  };

  return (
    <div className="w-full h-full flex flex-col bg-[var(--holo-bg)] text-[var(--holo-text)]">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-[var(--holo-border)]">
        <Newspaper size={18} className="text-[var(--holo-accent)]" />
        <h1 className="text-sm font-medium">News</h1>
        <span className="text-xs text-[var(--holo-muted)] font-mono">
          {articles.length} {breaking ? 'breaking' : 'item'}
          {articles.length === 1 ? '' : 's'}
          {offline ? ' · offline' : ''}
        </span>
        <button
          onClick={refetch}
          className="ml-auto text-[var(--holo-muted)] hover:text-[var(--holo-accent)] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </header>

      {/* Filter row: Breaking leads as the highest-signal toggle (an orthogonal
          urgency axis), separated from the category chips, which follow in the
          semantic CATEGORIES order. */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-[var(--holo-border)] overflow-x-auto">
        <button
          onClick={() => setBreaking((v) => !v)}
          className={`${CHIP_BASE} inline-flex items-center gap-1 ${breaking ? BREAKING_ACTIVE : CHIP_IDLE}`}
          title="High-urgency items only"
        >
          <Zap size={11} />
          Breaking
        </button>
        <span className="text-[var(--holo-border)] px-0.5">|</span>
        <button
          onClick={() => selectCategory(null)}
          className={`${CHIP_BASE} ${!breaking && category === null ? CHIP_ACTIVE : CHIP_IDLE}`}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => selectCategory(c)}
            className={`${CHIP_BASE} ${!breaking && category === c ? CHIP_ACTIVE : CHIP_IDLE}`}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="text-sm text-[var(--holo-muted)] text-center mt-8">Reading the feed…</p>
        )}
        {!loading && error && !offline && (
          <p className="text-sm text-amber-300 text-center mt-8 px-6">{error}</p>
        )}
        {!loading && articles.length === 0 && !error && (
          <div className="flex flex-col items-center gap-3 text-center mt-12 px-6">
            <Newspaper size={96} style={{ color: 'rgba(255,255,255,0.08)' }} />
            <p className="text-sm text-[var(--holo-muted)]">
              {breaking ? 'Nothing breaking right now.' : 'No headlines yet.'}
            </p>
            <p className="text-xs text-[var(--holo-muted)]">
              The feeds poll on their own cadence — check back shortly.
            </p>
          </div>
        )}
        {articles.map((a) => (
          <ArticleRow key={a.id} article={a} onOpen={() => openArticle(a)} />
        ))}
      </div>
    </div>
  );
}
