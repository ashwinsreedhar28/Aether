import { GitBranch, RefreshCw, Circle } from 'lucide-react';
import { useMeshSurface } from '../../hooks/useMeshSurface';

// Re-homed Aether surface: dev lanes (nodes/lanes). Which git worktrees are
// active vs idle — the surface Aether watches while it builds. Reads lanes.status.

// Live CC session signal (nodes/lanes/src/types.ts AgentInfo). null/undefined →
// detection unavailable (lsof missing), distinct from { active: false } meaning
// "detected, none here".
interface AgentInfo {
  active: boolean;
  count: number;
}

interface Lane {
  name: string;
  path: string;
  branch: string;
  is_main: boolean;
  dirty_count: number;
  last_commit_msg?: string | null;
  last_activity_ms: number;
  state: 'active' | 'idle';
  agent?: AgentInfo | null;
  pr?: { number: number; state: string; url: string } | null;
}
interface LanesPayload {
  lanes: Lane[];
  fetched_at_ms: number;
  stale: boolean;
  gh_available: boolean;
}

function relTime(ms: number): string {
  if (!ms) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function LanesApp() {
  const { data, error, loading, refreshing, refetch } = useMeshSurface<LanesPayload>('lanes.status', {});
  const lanes = data?.lanes ?? [];
  const active = lanes.filter((l) => l.state === 'active').length;

  return (
    <div className="w-full h-full flex flex-col bg-[var(--holo-bg)] text-[var(--holo-text)]">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-[var(--holo-border)]">
        <GitBranch size={18} className="text-[var(--holo-accent)]" />
        <h1 className="text-sm font-medium">Lanes</h1>
        <span className="text-xs text-[var(--holo-muted)] font-mono">
          {active} active · {lanes.length} total{data?.stale ? ' · stale' : ''}
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
        {loading && <p className="text-sm text-[var(--holo-muted)] px-1">Loading lanes…</p>}
        {error && <p className="text-sm text-amber-300 px-1">{error}</p>}
        {!loading && !error && lanes.length === 0 && (
          <p className="text-sm text-[var(--holo-muted)] px-1">No worktrees.</p>
        )}
        {!loading && !error && lanes.map((l) => (
          <div key={l.path} className="rounded-md border border-[var(--holo-border)] bg-[var(--holo-panel)]/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <Circle
                size={9}
                className={l.state === 'active' ? 'text-green-500 fill-green-500' : 'text-[var(--holo-muted)]'}
              />
              <span className="text-sm font-mono truncate">{l.branch}</span>
              {l.is_main && <span className="text-[10px] uppercase tracking-wider text-[var(--holo-muted)]">main</span>}
              {l.agent?.active && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)]"
                  title={`${l.agent.count} live Claude Code session${l.agent.count === 1 ? '' : 's'} in this worktree`}
                >
                  AGENT{l.agent.count > 1 ? ` ×${l.agent.count}` : ''}
                </span>
              )}
              {l.pr?.number != null && (
                <span className="text-[10px] text-[var(--holo-muted)] font-mono">#{l.pr.number}</span>
              )}
              <span className="ml-auto text-[10px] text-[var(--holo-muted)] font-mono">{relTime(l.last_activity_ms)}</span>
            </div>
            {l.last_commit_msg && (
              <p className="text-xs text-[var(--holo-muted)] mt-1 truncate pl-4">{l.last_commit_msg}</p>
            )}
            {l.dirty_count > 0 && (
              <p className="text-[10px] text-amber-400/80 mt-0.5 pl-4 font-mono">{l.dirty_count} uncommitted</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
