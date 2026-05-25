import type { BrokerIntrospection, FetchResult } from './types'

const FETCH_TIMEOUT_MS = 1500

export async function fetchIntrospection(
  coreUrl: string,
  adminToken: string,
): Promise<FetchResult> {
  const url = `${coreUrl}/__introspection__`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-Admin-Token': adminToken },
      signal: controller.signal,
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, kind: 'broker_unauthorized' }
    }
    if (!res.ok) {
      // Treat any non-2xx that isn't auth as a transport-level failure.
      // The broker only serves 200 + 401/403 on this endpoint today; a
      // 500 means the broker is up but malfunctioning, which from this
      // node's perspective is the same as unreachable for cache purposes.
      return { ok: false, kind: 'broker_unreachable' }
    }
    const data = (await res.json()) as BrokerIntrospection
    return { ok: true, data }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, kind: 'broker_timeout' }
    }
    return { ok: false, kind: 'broker_unreachable' }
  } finally {
    clearTimeout(timer)
  }
}
