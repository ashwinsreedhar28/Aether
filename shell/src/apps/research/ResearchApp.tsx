import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import { BookOpen, ExternalLink, FileText, Loader2, Search } from 'lucide-react';
import { useMeshSurface } from '../../hooks/useMeshSurface';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { app as browserApp } from '../browser';
import { relTime } from '../../utils/relTime';

// The research vertical's face — Aether's first Mixer app. Query input →
// research.brief (search + ONE Claude synthesis) rendered on submit, plus a
// recent-briefs strip backed by research.recent for recall. Unlike the Sensor
// apps (News, Stocks) this drives a *slow* surface: the brief invoke runs an
// LLM call, so submit shows a synthesizing state and uses a direct
// window.aether.mesh.invoke (not the polling hook). recent.recent is the only
// poll-able surface here; we refetch it after a new brief lands.
//
// Wire shapes mirrored from nodes/research/src/types.ts (single source of
// truth lives there; redeclared locally like the other MeshApps — no cross-
// workspace import of node types into the renderer). citations index into the
// brief's papers list by paperId.
interface ResearchPaper {
  paperId: string;
  title: string;
  abstract: string | null;
  year: number | null;
  authors: string[];
  venue: string | null;
  citationCount: number;
  influentialCitationCount: number;
  url: string;
  pdfUrl: string | null;
}
interface ResearchBriefSection {
  heading: string;
  body: string;
  citations: string[];
}
interface ResearchBrief {
  query: string;
  sections: ResearchBriefSection[];
  papers: ResearchPaper[];
  generatedAt: string;
}
interface RecentPayload {
  briefs: ResearchBrief[];
}

const QUERY_MAX_LEN = 300;

// Translate a node MeshDeny reason code (surfaced as error.message) into a
// readable line. Unknown reasons fall through verbatim.
function friendlyError(reason: string | undefined): string {
  switch (reason) {
    case 'research_bad_query':
      return 'That query was empty or too long — try a shorter topic.';
    case 'research_no_papers':
      return 'No papers found for that query. Try different wording.';
    case 'research_search_failed':
      return 'Semantic Scholar is unavailable right now — try again shortly.';
    case 'research_synthesis_failed':
      return 'Synthesis failed — the research node needs ANTHROPIC_API_KEY configured.';
    default:
      return reason ?? 'Brief unavailable.';
  }
}

function authorLine(p: ResearchPaper): string {
  if (p.authors.length === 0) return 'Unknown authors';
  const lead = p.authors.slice(0, 3).join(', ');
  return p.authors.length > 3 ? `${lead} et al.` : lead;
}

// Short citation chip label: lead author surname + year, e.g. "Vaswani '17".
function citationLabel(p: ResearchPaper): string {
  const surname = (p.authors[0] ?? 'Unknown').split(' ').slice(-1)[0] ?? 'Unknown';
  const yr = p.year != null ? ` '${String(p.year).slice(-2)}` : '';
  return `${surname}${yr}`;
}

function PaperCard({
  paper,
  index,
  highlighted,
  onOpen,
}: {
  paper: ResearchPaper;
  index: number;
  highlighted: boolean;
  onOpen: (url: string) => void;
}) {
  return (
    <div
      id={`research-paper-${paper.paperId}`}
      className="rounded-lg border p-3 transition-colors"
      style={{
        borderColor: highlighted ? 'var(--holo-accent)' : 'var(--holo-border)',
        background: highlighted ? 'var(--holo-accent-soft, rgba(255,255,255,0.04))' : 'var(--holo-panel)',
      }}
    >
      <div className="flex items-start gap-2">
        <span className="text-[11px] font-mono text-[var(--holo-muted)] mt-0.5">[{index + 1}]</span>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium leading-snug text-[var(--holo-text)]">{paper.title}</h4>
          <p className="text-[11px] text-[var(--holo-muted)] mt-0.5">
            {authorLine(paper)}
            {paper.year != null ? ` · ${paper.year}` : ''}
            {paper.venue ? ` · ${paper.venue}` : ''}
            {` · ${paper.citationCount} cites`}
          </p>
          {paper.abstract && (
            <p
              className="text-xs text-[var(--holo-muted)] leading-relaxed mt-1.5"
              style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            >
              {paper.abstract}
            </p>
          )}
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={() => onOpen(paper.url)}
              className="inline-flex items-center gap-1 text-[11px] text-[var(--holo-accent)] hover:underline"
            >
              <ExternalLink size={11} /> Open
            </button>
            {paper.pdfUrl && (
              <button
                onClick={() => onOpen(paper.pdfUrl as string)}
                className="inline-flex items-center gap-1 text-[11px] text-[var(--holo-muted)] hover:text-[var(--holo-accent)]"
              >
                <FileText size={11} /> PDF
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ResearchApp() {
  const [query, setQuery] = useState('');
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const openWindow = useWorkspaceStore((s) => s.openWindow);

  // Recall surface — no polling (briefs change only when the user generates
  // one); refetched after a successful brief. Hydrates from cache on mount.
  const recent = useMeshSurface<RecentPayload>('research.recent', {}, {
    pollMs: 0,
    cacheKey: 'research-recent',
  });
  const recentRef = useRef(recent.refetch);
  recentRef.current = recent.refetch;

  const paperById = useMemo(() => {
    const m = new Map<string, { paper: ResearchPaper; index: number }>();
    brief?.papers.forEach((paper, index) => m.set(paper.paperId, { paper, index }));
    return m;
  }, [brief]);

  const openExternal = useCallback(
    (url: string) => {
      openWindow({
        title: 'Paper',
        appId: 'browser',
        // Browser treats an http(s) filePath as its initial URL; must be truthy
        // or the window materializes tabless (controlBridge gotcha).
        filePath: url,
        position: { x: 160 + Math.random() * 100, y: 90 + Math.random() * 100 },
        size: browserApp.defaultSize || { width: 1024, height: 768 },
        isMinimized: false,
        isMaximized: false,
      });
    },
    [openWindow],
  );

  const jumpToPaper = (paperId: string) => {
    const el = document.getElementById(`research-paper-${paperId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(paperId);
    window.setTimeout(() => setHighlightId((cur) => (cur === paperId ? null : cur)), 1600);
  };

  const runBrief = useCallback(
    async (raw: string) => {
      const q = raw.trim().slice(0, QUERY_MAX_LEN);
      if (!q) return;
      setLoading(true);
      setError(null);
      setBrief(null);
      try {
        const res = await window.aether.mesh.invoke('research.brief', { query: q });
        if (res.ok && res.envelope) {
          setBrief(res.envelope.payload as unknown as ResearchBrief);
          recentRef.current();
        } else {
          // The renderer invoke surfaces the node's MeshDeny reason code as
          // error.message; translate the known codes to a readable line.
          setError(friendlyError(res.error?.message));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Brief failed');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void runBrief(query);
  };

  const loadRecent = (b: ResearchBrief) => {
    setBrief(b);
    setQuery(b.query);
    setError(null);
  };

  const recentBriefs = recent.data?.briefs ?? [];

  return (
    <div className="w-full h-full flex flex-col bg-[var(--holo-bg)] text-[var(--holo-text)]">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-[var(--holo-border)]">
        <BookOpen size={18} className="text-[var(--holo-accent)]" />
        <h1 className="text-sm font-medium">Research</h1>
        {brief && (
          <span className="text-xs text-[var(--holo-muted)] truncate">
            {brief.papers.length} papers · {relTime(Date.parse(brief.generatedAt), '')}
          </span>
        )}
      </header>

      <form onSubmit={onSubmit} className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--holo-border)]">
        <Search size={14} className="text-[var(--holo-muted)] shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={QUERY_MAX_LEN}
          placeholder="Research a topic — e.g. retrieval-augmented generation"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--holo-muted)]"
        />
        <button
          type="submit"
          disabled={loading || query.trim().length === 0}
          className="text-xs px-3 py-1 rounded-md border border-[var(--holo-accent)]/60 bg-[var(--holo-accent)]/15 text-[var(--holo-accent)] disabled:opacity-40 transition-colors"
        >
          {loading ? 'Synthesizing…' : 'Brief'}
        </button>
      </form>

      {/* Recent-briefs recall strip — clickable query chips. */}
      {recentBriefs.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-[var(--holo-border)] overflow-x-auto">
          <span className="text-[11px] text-[var(--holo-muted)] shrink-0">Recent</span>
          {recentBriefs.map((b) => (
            <button
              key={`${b.query}-${b.generatedAt}`}
              onClick={() => loadRecent(b)}
              title={`${b.query} · ${relTime(Date.parse(b.generatedAt), '')}`}
              className="text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap border-[var(--holo-border)] text-[var(--holo-muted)] hover:text-[var(--holo-text)] hover:border-[var(--holo-accent)]/60 transition-colors max-w-[180px] truncate"
            >
              {b.query}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex flex-col items-center gap-2 text-center mt-12 px-6">
            <Loader2 size={28} className="animate-spin text-[var(--holo-accent)]" />
            <p className="text-sm text-[var(--holo-muted)]">Synthesizing a brief…</p>
            <p className="text-xs text-[var(--holo-muted)]">
              Searching Semantic Scholar and asking Claude to synthesize — a few seconds.
            </p>
          </div>
        )}

        {!loading && error && (
          <p className="text-sm text-amber-300 text-center mt-10 px-6">{error}</p>
        )}

        {!loading && !error && !brief && (
          <div className="flex flex-col items-center gap-3 text-center mt-12 px-6">
            <BookOpen size={84} style={{ color: 'rgba(255,255,255,0.08)' }} />
            <p className="text-sm text-[var(--holo-muted)]">
              {recentBriefs.length > 0
                ? 'Pick a recent brief above, or search a new topic.'
                : 'Search a topic to synthesize a cited research brief.'}
            </p>
          </div>
        )}

        {!loading && brief && (
          <div className="px-4 py-3 space-y-5">
            <section className="space-y-3">
              {brief.sections.map((s, i) => (
                <div key={`${s.heading}-${i}`}>
                  <h3 className="text-sm font-semibold text-[var(--holo-text)]">{s.heading}</h3>
                  <p className="text-sm text-[var(--holo-muted)] leading-relaxed mt-0.5">{s.body}</p>
                  {s.citations.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {s.citations.map((pid) => {
                        const hit = paperById.get(pid);
                        if (!hit) return null;
                        return (
                          <button
                            key={pid}
                            onClick={() => jumpToPaper(pid)}
                            title={hit.paper.title}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--holo-accent)]/50 text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/15 transition-colors"
                          >
                            {citationLabel(hit.paper)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-medium text-[var(--holo-muted)] uppercase tracking-wider">
                Papers ({brief.papers.length})
              </h2>
              {brief.papers.map((p, i) => (
                <PaperCard
                  key={p.paperId}
                  paper={p}
                  index={i}
                  highlighted={highlightId === p.paperId}
                  onOpen={openExternal}
                />
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
