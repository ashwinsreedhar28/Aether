import { useCallback, useEffect, useRef, useState } from 'react';

// Shared hook for the re-homed Aether surfaces (mesh / lanes / gaps / agenda).
// Invokes a mesh surface through window.aether.mesh, polls while mounted, and
// degrades to an `error` string instead of throwing when the mesh is starting,
// the edge is denied, or the node is unreachable.

export interface MeshSurfaceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  refetch: () => void;
}

export function useMeshSurface<T = Record<string, unknown>>(
  target: string,
  payload: Record<string, unknown> = {},
  pollMs = 4000,
): MeshSurfaceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Stable payload reference across renders (callers pass object literals).
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const fetchOnce = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await window.aether.mesh.invoke(target, payloadRef.current);
      if (res.ok && res.envelope) {
        setData(res.envelope.payload as unknown as T);
        setError(null);
      } else {
        setError(res.error?.message ?? `${target} unavailable`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : `${target} unavailable`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [target]);

  const fetchRef = useRef(fetchOnce);
  fetchRef.current = fetchOnce;

  useEffect(() => {
    void fetchRef.current();
    if (pollMs <= 0) return;
    const interval = setInterval(() => void fetchRef.current(), pollMs);
    return () => clearInterval(interval);
  }, [target, pollMs]);

  return { data, error, loading, refreshing, refetch: () => void fetchRef.current() };
}
