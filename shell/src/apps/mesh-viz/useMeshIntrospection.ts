import { useCallback, useEffect, useRef, useState } from 'react'
import type { MeshInvokeResult } from '../../../electron/preload'
import type { ActivityPayload, TopologyPayload } from './types'

// Poll cadence matches the mesh_introspection node's own 2s poll of Core's
// /__introspection__ endpoint (#111). Polling faster than the node refreshes
// would just re-serve the same cached snapshot.
const POLL_INTERVAL_MS = 2_000

export interface MeshIntrospectionState {
  topology: TopologyPayload | null
  activity: ActivityPayload | null
  /** Client-side Date.now() of the last successful topology fetch, or null. */
  lastSuccessAt: number | null
  /** Latest error message; cleared on the next success. */
  error: string | null
}

function readEnvelope<T>(result: MeshInvokeResult): { ok: true; value: T } | { ok: false; error: string } {
  if (!result.ok || !result.envelope) {
    return { ok: false, error: result.error?.message ?? 'mesh invoke returned no envelope' }
  }
  return { ok: true, value: result.envelope.payload as T }
}

/**
 * Polls mesh_introspection.topology and .activity every 2s via the signed-
 * envelope mesh path (NOT a direct /__introspection__ fetch — the renderer has
 * no ADMIN_TOKEN). On any failure the last successful payload is retained so a
 * transient broker hiccup doesn't blank the viz; the error is surfaced for the
 * caller to decide between the "unreachable" first-load state and a silent
 * keep-last reconnect.
 */
export function useMeshIntrospection(): MeshIntrospectionState {
  const [state, setState] = useState<MeshIntrospectionState>({
    topology: null,
    activity: null,
    lastSuccessAt: null,
    error: null,
  })

  // Guard against a poll resolving after unmount.
  const mounted = useRef(true)

  const poll = useCallback(async (): Promise<void> => {
    let topoResult: MeshInvokeResult
    let actResult: MeshInvokeResult
    try {
      ;[topoResult, actResult] = await Promise.all([
        window.aether.mesh.invoke('mesh_introspection.topology', {}),
        window.aether.mesh.invoke('mesh_introspection.activity', {}),
      ])
    } catch (e) {
      if (!mounted.current) return
      setState((prev) => ({ ...prev, error: (e as Error).message ?? 'IPC failed' }))
      return
    }
    if (!mounted.current) return

    const topo = readEnvelope<TopologyPayload>(topoResult)
    const act = readEnvelope<ActivityPayload>(actResult)

    setState((prev) => {
      const next: MeshIntrospectionState = { ...prev }
      if (topo.ok) {
        next.topology = topo.value
        next.lastSuccessAt = Date.now()
      }
      if (act.ok) {
        next.activity = act.value
      }
      // Surface the first failure of the pair; clear once both legs succeed.
      next.error = topo.ok && act.ok ? null : !topo.ok ? topo.error : !act.ok ? act.error : null
      return next
    })
  }, [])

  useEffect(() => {
    mounted.current = true
    void poll()
    const id = setInterval(() => {
      void poll()
    }, POLL_INTERVAL_MS)
    return () => {
      mounted.current = false
      clearInterval(id)
    }
  }, [poll])

  return state
}
