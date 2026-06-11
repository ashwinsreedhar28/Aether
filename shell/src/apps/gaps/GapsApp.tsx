import { useState } from 'react';
import { CircleDot, KeyRound, MessageSquare, RefreshCw } from 'lucide-react';
import { useMeshSurface } from '../../hooks/useMeshSurface';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { app as browserApp } from '../browser';

// Re-homed Aether surface: the gap board (nodes/github). Gaps are GitHub
// issues (#255) — this panel is a live view over the open issue board, read
// through github.list_issues. The local ledger path (intents.list) is retired.

// Issue shape per nodes/github/README.md surface contract: labels are label
// names; created_at is ISO 8601; comments is the +1 demand signal on deduped
// gaps; url is the html click-through target.
interface BoardIssue {
  number: number;
  title: string;
  labels: string[];
  state: string;
  created_at: string;
  updated_at: string;
  comments: number;
  url: string;
  author: string;
}
interface BoardPayload {
  issues: BoardIssue[];
  fetched_at_ms: number;
  stale: boolean;
  token_available: boolean;
}

function relTime(ms: number): string {
  if (!ms || Number.isNaN(ms)) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const GAP_CHIP =
  'text-[10px] px-1.5 py-0.5 rounded border border-[var(--holo-accent)]/60 bg-[var(--holo-accent)]/20 text-[var(--holo-accent)]';
const PLAIN_CHIP =
  'text-[10px] px-1.5 py-0.5 rounded border border-[var(--holo-border)] text-[var(--holo-muted)]';

export function GapsApp() {
  const [gapOnly, setGapOnly] = useState(false);
  const openWindow = useWorkspaceStore((s) => s.openWindow);

  // limit 100 (the surface max) so the gap-only chip can filter client-side
  // without a second fetch; one poll stream, one cache entry, instant toggle.
  const { data, error, loading, refreshing, fetchedAtMs, refetch } = useMeshSurface<BoardPayload>(
    'github.list_issues',
    { limit: 100 },
    { pollMs: 60_000, visibleOnly: true, cacheKey: 'github-issues' },
  );

  const all = data?.issues ?? [];
  const gaps = all.filter((i) => i.labels.includes('gap'));
  const issues = gapOnly ? gaps : all;
  const noToken = data != null && data.token_available === false;
  // error with data still present = the node is unreachable but the hook is
  // rendering its last good fetch (in-memory or localStorage) — offline mode.
  const offline = error != null && data != null;

  const openIssue = (issue: BoardIssue) => {
    openWindow({
      title: `#${issue.number} · ${issue.title}`,
      appId: 'browser',
      // Browser treats an http(s) filePath as its initial URL; filePath must
      // be truthy or the window materializes tabless (controlBridge gotcha).
      filePath: issue.url,
      position: { x: 150 + Math.random() * 100, y: 80 + Math.random() * 100 },
      size: browserApp.defaultSize || { width: 1024, height: 768 },
      isMinimized: false,
      isMaximized: false,
    });
  };

  return (
    <div className="w-full h-full flex flex-col bg-[var(--holo-bg)] text-[var(--holo-text)]">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-[var(--holo-border)]">
        <CircleDot size={18} className="text-[var(--holo-accent)]" />
        <h1 className="text-sm font-medium">Gaps</h1>
        <span className="text-xs text-[var(--holo-muted)] font-mono">
          {all.length} open · {gaps.length} gap{data?.stale ? ' · stale' : ''}
        </span>
        <button
          onClick={() => setGapOnly((v) => !v)}
          className={`ml-auto transition-colors ${gapOnly ? GAP_CHIP : PLAIN_CHIP + ' hover:text-[var(--holo-text)]'}`}
          title="Show gap-labeled issues only"
        >
          gap-only
        </button>
        <button
          onClick={refetch}
          className="text-[var(--holo-muted)] hover:text-[var(--holo-accent)] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </header>

      {offline && (
        <p className="text-xs text-amber-300 px-4 py-1.5 border-b border-[var(--holo-border)]">
          Live fetch failing ({error}) — board as of {relTime(fetchedAtMs ?? 0)}
        </p>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && <p className="text-sm text-[var(--holo-muted)] px-1">Loading the board…</p>}

        {!loading && noToken && (
          <div className="flex items-start gap-2 px-1 py-2">
            <KeyRound size={14} className="text-[var(--holo-muted)] mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm">GitHub token not configured.</p>
              <p className="text-xs text-[var(--holo-muted)] mt-1">
                Set AETHER_GITHUB_TOKEN (fine-grained PAT, Issues RW) to render the live board.
              </p>
            </div>
          </div>
        )}

        {!loading && error && data == null && (
          <p className="text-sm text-amber-300 px-1">{error}</p>
        )}

        {!loading && !noToken && data != null && issues.length === 0 && (
          <p className="text-sm text-[var(--holo-muted)] px-1">
            {gapOnly ? 'No open gaps.' : 'No open issues.'}
          </p>
        )}

        {!noToken &&
          issues.map((i) => (
            <button
              key={i.number}
              onClick={() => openIssue(i)}
              className="w-full text-left rounded-md border border-[var(--holo-border)] bg-[var(--holo-panel)]/40 px-3 py-2 hover:border-[var(--holo-accent)]/50 transition-colors"
              title={`Open #${i.number} in the browser`}
            >
              <div className="flex items-start gap-2">
                <CircleDot size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug">
                    <span className="font-mono text-[var(--holo-muted)]">#{i.number}</span> {i.title}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {i.labels.map((label) => (
                      <span key={label} className={label === 'gap' ? GAP_CHIP : PLAIN_CHIP}>
                        {label}
                      </span>
                    ))}
                    {i.comments > 0 && (
                      <span
                        className="flex items-center gap-0.5 text-[10px] text-[var(--holo-accent)] font-mono"
                        title={`${i.comments} comment${i.comments === 1 ? '' : 's'} — the +1 demand signal`}
                      >
                        <MessageSquare size={10} /> {i.comments}
                      </span>
                    )}
                    <span
                      className="ml-auto text-[10px] text-[var(--holo-muted)] font-mono"
                      title={`opened by ${i.author}`}
                    >
                      {relTime(Date.parse(i.created_at))}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))}
      </div>
    </div>
  );
}
