import { CircleDashed, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useMeshSurface } from '../../hooks/useMeshSurface';

// Re-homed Aether surface: the gap sensor (nodes/intents). What Aether cannot
// (yet) do — the first brick of the self-build loop. Reads intents.list.

interface Gap {
  id: string;
  ts: string;
  text: string;
  context: string | null;
  status: 'open' | 'closed';
}
interface GapsPayload {
  gaps: Gap[];
  counts: { open?: number; closed?: number };
}

function relTime(ts: string): string {
  const d = Date.parse(ts);
  if (Number.isNaN(d)) return '';
  const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function GapsApp() {
  const { data, error, loading, refreshing, refetch } = useMeshSurface<GapsPayload>('intents.list', {
    status: 'all',
    limit: 200,
  });

  const gaps = data?.gaps ?? [];
  const open = data?.counts?.open ?? gaps.filter((g) => g.status === 'open').length;
  const closed = data?.counts?.closed ?? gaps.filter((g) => g.status === 'closed').length;

  return (
    <div className="w-full h-full flex flex-col bg-[var(--holo-bg)] text-[var(--holo-text)]">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-[var(--holo-border)]">
        <CircleDashed size={18} className="text-[var(--holo-accent)]" />
        <h1 className="text-sm font-medium">Gaps</h1>
        <span className="text-xs text-[var(--holo-muted)] font-mono">
          {open} open · {closed} closed
        </span>
        <button
          onClick={refetch}
          className="ml-auto text-[var(--holo-muted)] hover:text-[var(--holo-accent)] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && <p className="text-sm text-[var(--holo-muted)] px-1">Loading gaps…</p>}
        {error && <p className="text-sm text-amber-300 px-1">{error}</p>}
        {!loading && !error && gaps.length === 0 && (
          <p className="text-sm text-[var(--holo-muted)] px-1">No gaps recorded. Aether can do everything asked of it… so far.</p>
        )}
        {gaps.map((g) => (
          <div
            key={g.id}
            className={`rounded-md border px-3 py-2 ${
              g.status === 'closed'
                ? 'border-[var(--holo-border)] opacity-50'
                : 'border-[var(--holo-border)] bg-[var(--holo-panel)]/40'
            }`}
          >
            <div className="flex items-start gap-2">
              {g.status === 'closed' ? (
                <CheckCircle2 size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
              ) : (
                <CircleDashed size={14} className="text-[var(--holo-accent)] mt-0.5 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">{g.text}</p>
                {g.context && <p className="text-xs text-[var(--holo-muted)] mt-1">{g.context}</p>}
                <p className="text-[10px] text-[var(--holo-muted)] font-mono mt-1">{relTime(g.ts)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
