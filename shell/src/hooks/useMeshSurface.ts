import { useCallback, useEffect, useRef, useState } from 'react';

// Shared hook for the re-homed Aether surfaces (mesh / lanes / gaps / agenda).
// Invokes a mesh surface through window.aether.mesh, polls while mounted, and
// degrades to an `error` string instead of throwing when the mesh is starting,
// the edge is denied, or the node is unreachable.
//
// Options (third arg; a bare number is shorthand for { pollMs }):
// - pollMs: poll interval in ms, <= 0 disables polling (default 4000).
// - visibleOnly: skip poll ticks while document.hidden, then refetch the
//   moment the document is visible again. Manual refetch is never gated.
// - cacheKey: persist the last good payload to localStorage and hydrate from
//   it on mount, so the surface still renders offline (stale data + error).

export interface MeshSurfaceOptions {
  pollMs?: number;
  visibleOnly?: boolean;
  cacheKey?: string;
}

export interface MeshSurfaceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  /** Epoch ms when `data` was fetched — by a live invoke or the hydrated cache. */
  fetchedAtMs: number | null;
  refetch: () => void;
}

interface CacheEntry<T> {
  t: number; // epoch ms of the fetch that produced the payload
  p: T;
}

function readCache<T>(cacheKey: string | undefined): CacheEntry<T> | null {
  if (!cacheKey) return null;
  try {
    const raw = localStorage.getItem(`mesh-surface:${cacheKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CacheEntry<T>>;
    if (typeof parsed.t !== 'number' || parsed.p == null) return null;
    return parsed as CacheEntry<T>;
  } catch {
    return null; // corrupt or legacy entry — same as no cache
  }
}

export function useMeshSurface<T = Record<string, unknown>>(
  target: string,
  payload: Record<string, unknown> = {},
  options: number | MeshSurfaceOptions = {},
): MeshSurfaceState<T> {
  const opts: MeshSurfaceOptions = typeof options === 'number' ? { pollMs: options } : options;
  const { pollMs = 4000, visibleOnly = false, cacheKey } = opts;

  // Hydrate once per mount; cached data renders immediately (loading stays
  // false) while the on-mount fetch runs as a `refreshing` pass over it.
  const [cached] = useState(() => readCache<T>(cacheKey));
  const [data, setData] = useState<T | null>(cached?.p ?? null);
  const [fetchedAtMs, setFetchedAtMs] = useState<number | null>(cached?.t ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(cached == null);
  const [refreshing, setRefreshing] = useState(false);

  // Stable payload reference across renders (callers pass object literals).
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const fetchOnce = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await window.aether.mesh.invoke(target, payloadRef.current);
      if (res.ok && res.envelope) {
        const fetched = res.envelope.payload as unknown as T;
        const t = Date.now();
        setData(fetched);
        setFetchedAtMs(t);
        setError(null);
        if (cacheKey) {
          try {
            localStorage.setItem(`mesh-surface:${cacheKey}`, JSON.stringify({ t, p: fetched }));
          } catch {
            // Cache write is best-effort (quota, unserializable payload);
            // the live render must not break over it.
          }
        }
      } else {
        setError(res.error?.message ?? `${target} unavailable`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : `${target} unavailable`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [target, cacheKey]);

  const fetchRef = useRef(fetchOnce);
  fetchRef.current = fetchOnce;

  useEffect(() => {
    void fetchRef.current();
    if (pollMs <= 0) return;
    const interval = setInterval(() => {
      if (visibleOnly && document.hidden) return;
      void fetchRef.current();
    }, pollMs);
    if (!visibleOnly) return () => clearInterval(interval);
    // Hidden panels skip ticks, so refetch as soon as we are visible again
    // rather than waiting out the remainder of the interval.
    const onVisibilityChange = () => {
      if (!document.hidden) void fetchRef.current();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [target, pollMs, visibleOnly]);

  return { data, error, loading, refreshing, fetchedAtMs, refetch: () => void fetchRef.current() };
}
