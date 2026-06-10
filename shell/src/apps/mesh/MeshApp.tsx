import { Network, RefreshCw, Circle } from 'lucide-react';
import { useMeshSurface } from '../../hooks/useMeshSurface';

// Re-homed Aether surface: live mesh topology (nodes/mesh_introspection). The
// signed substrate that everything else rides on. Reads mesh_introspection.topology.

interface TopoNode {
  id: string;
  category?: string;
  connected?: boolean;
  surfaces?: unknown[];
}
interface TopoEdge {
  from: string;
  to: string;
}
interface TopologyPayload {
  nodes: TopoNode[];
  edges: TopoEdge[];
  stale: boolean;
  fetched_at_ms: number;
}

const CATEGORY_COLOR: Record<string, string> = {
  Sensor: 'text-sky-400',
  Actor: 'text-amber-400',
  Mixer: 'text-fuchsia-400',
};

export function MeshApp() {
  const { data, error, loading, refreshing, refetch } = useMeshSurface<TopologyPayload>(
    'mesh_introspection.topology',
    {},
    3000,
  );

  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  const connected = nodes.filter((n) => n.connected !== false).length;

  return (
    <div className="w-full h-full flex flex-col bg-[var(--holo-bg)] text-[var(--holo-text)]">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-[var(--holo-border)]">
        <Network size={18} className="text-[var(--holo-accent)]" />
        <h1 className="text-sm font-medium">Mesh</h1>
        <span className="text-xs text-[var(--holo-muted)] font-mono">
          {connected}/{nodes.length} nodes · {edges.length} edges{data?.stale ? ' · stale' : ''}
        </span>
        <button
          onClick={refetch}
          className="ml-auto text-[var(--holo-muted)] hover:text-[var(--holo-accent)] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {loading && <p className="text-sm text-[var(--holo-muted)] px-1">Loading topology…</p>}
        {error && <p className="text-sm text-amber-300 px-1">{error}</p>}
        {!loading && !error && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {nodes
              .slice()
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((n) => (
                <div
                  key={n.id}
                  className="rounded-md border border-[var(--holo-border)] bg-[var(--holo-panel)]/40 px-3 py-2"
                  title={n.category ?? ''}
                >
                  <div className="flex items-center gap-1.5">
                    <Circle
                      size={8}
                      className={n.connected === false ? 'text-[var(--holo-muted)]' : 'text-green-500 fill-green-500'}
                    />
                    <span className="text-xs font-mono truncate">{n.id}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    {n.category && (
                      <span className={`text-[10px] uppercase tracking-wider ${CATEGORY_COLOR[n.category] ?? 'text-[var(--holo-muted)]'}`}>
                        {n.category}
                      </span>
                    )}
                    {Array.isArray(n.surfaces) && (
                      <span className="text-[10px] text-[var(--holo-muted)] font-mono">{n.surfaces.length} surf</span>
                    )}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
