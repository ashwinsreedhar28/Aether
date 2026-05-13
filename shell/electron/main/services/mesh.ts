import { MeshNode, type Envelope } from '@homeos/mesh-node-sdk'
import { CoreManager } from './coreManager'
import { NodeManager } from './nodeManager'
import { generateMeshSecrets, type MeshSecrets } from './secrets'
import { cleanupStaleSpawns } from './staleSpawns'

// One-stop orchestrator for the mesh substrate. Owns:
//   * the Core daemon (Python child process)
//   * the host_notifications node (Node.js child process)
//   * the shell's MeshNode client (used by the renderer's mesh.invoke())
//
// The shell node never registers a stream — it has no inbound surfaces in
// v0.1.0 — so `MeshNode.start()` is intentionally not called. The SDK's
// .invoke() does not require a session.

export type MeshState = 'idle' | 'starting' | 'ready' | 'failed'

let secrets: MeshSecrets | null = null
let coreManager: CoreManager | null = null
let nodeManager: NodeManager | null = null
let shellNode: MeshNode | null = null
let meshState: MeshState = 'idle'
let meshError: string | null = null

export interface MeshInvokeError {
  status: number | null
  message: string
  data?: unknown
}

export interface MeshInvokeResult {
  ok: boolean
  envelope?: Envelope
  accepted?: { id: string; status: 'accepted' }
  error?: MeshInvokeError
  durationMs: number
}

// Boots in the background; throws on failure so the caller can surface a
// dialog without quitting the shell. After v0.1.0, the shell stays usable
// for non-mesh apps (Welcome / News / Markdown) even if mesh fails.
export async function startMesh(): Promise<void> {
  if (meshState === 'starting' || meshState === 'ready') return
  meshState = 'starting'
  meshError = null
  try {
    // Kill any Core / host_notifications left behind by a previous run that
    // didn't clean up — e.g. a dev-mode HMR restart that SIGKILL'd the old
    // Electron main before before-quit could fire. See staleSpawns.ts.
    await cleanupStaleSpawns()
    secrets = generateMeshSecrets()
    coreManager = new CoreManager({ secrets })
    await coreManager.ensureRunning()
    shellNode = new MeshNode('shell', secrets.shellSecret, coreManager.url)
    nodeManager = new NodeManager({ secrets, coreUrl: coreManager.url })
    await nodeManager.startAll()
    meshState = 'ready'
  } catch (err) {
    meshState = 'failed'
    meshError = (err as Error).message ?? String(err)
    // Tear down anything that did come up — leaving partial state would
    // mean a half-spawned Core hanging around if e.g. node spawn failed.
    try {
      await nodeManager?.stopAll()
    } catch {
      /* best-effort */
    }
    try {
      await coreManager?.stop()
    } catch {
      /* best-effort */
    }
    nodeManager = null
    coreManager = null
    shellNode = null
    secrets = null
    throw err
  }
}

export async function stopMesh(): Promise<void> {
  // Parallel SIGTERM + waitForExit on every child. Sequential stop took up
  // to 12s worst-case, long enough to risk Electron's quit timeout firing
  // before cleanup completed. Running them in parallel keeps worst-case at
  // ~7s (the longer of the two child timeouts).
  const nodeStop = nodeManager?.stopAll() ?? Promise.resolve()
  const coreStop = coreManager?.stop() ?? Promise.resolve()
  const results = await Promise.allSettled([nodeStop, coreStop])
  for (const r of results) {
    if (r.status === 'rejected') {
      console.warn('[stopMesh] child cleanup rejected:', r.reason)
    }
  }
  nodeManager = null
  shellNode = null
  coreManager = null
  secrets = null
  meshState = 'idle'
  meshError = null
}

export function getCoreUrl(): string | null {
  return coreManager?.url ?? null
}

export async function isCoreHealthy(): Promise<boolean> {
  return (await coreManager?.health()) ?? false
}

export function getMeshState(): { state: MeshState; error: string | null } {
  return { state: meshState, error: meshError }
}

// Identity bundle handed to the raven daemon at spawn time. Returns null
// until the mesh is fully ready — the raven manager waits for `ready`
// before spawning Python (its first-run bootstrap takes ~30s anyway,
// which is more than enough headroom for Core + nodes to come up in
// parallel). After v0.1.0 this generalises to a per-node identity
// lookup; we hard-code raven here to avoid premature abstraction.
export function getRavenMeshConfig(): { ravenSecret: string; coreUrl: string } | null {
  if (meshState !== 'ready' || !secrets || !coreManager) return null
  return { ravenSecret: secrets.ravenSecret, coreUrl: coreManager.url }
}

// Wait up to `timeoutMs` for mesh to reach `ready`. Returns false on
// timeout OR if mesh entered `failed` (no point waiting longer).
export async function waitForMeshReady(timeoutMs: number): Promise<boolean> {
  const POLL_MS = 100
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (meshState === 'ready') return true
    if (meshState === 'failed') return false
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  return meshState === 'ready'
}

export async function meshInvoke(
  target: string,
  payload: Record<string, unknown>,
): Promise<MeshInvokeResult> {
  const node = shellNode
  if (!node) {
    return {
      ok: false,
      error: {
        status: null,
        message: meshState === 'starting' ? 'mesh is still starting' : 'mesh not available',
      },
      durationMs: 0,
    }
  }
  const started = Date.now()
  try {
    const result = await node.invoke(target, payload)
    const durationMs = Date.now() - started
    if ('kind' in result) {
      const env = result as Envelope
      if (env.kind === 'error') {
        return {
          ok: false,
          envelope: env,
          error: {
            status: 200,
            message:
              typeof env.payload?.reason === 'string'
                ? (env.payload.reason as string)
                : 'mesh_error',
            data: env.payload,
          },
          durationMs,
        }
      }
      return { ok: true, envelope: env, durationMs }
    }
    return { ok: true, accepted: result, durationMs }
  } catch (e) {
    const durationMs = Date.now() - started
    const err = e as { status?: number; data?: unknown; message?: string }
    return {
      ok: false,
      error: {
        status: typeof err.status === 'number' ? err.status : null,
        message: err.message ?? 'invoke failed',
        data: err.data,
      },
      durationMs,
    }
  }
}
