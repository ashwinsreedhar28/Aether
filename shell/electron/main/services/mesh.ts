import { MeshNode, type Envelope } from '@homeos/mesh-node-sdk'
import { CoreManager } from './coreManager'
import { NodeManager } from './nodeManager'
import { generateMeshSecrets, type MeshSecrets } from './secrets'

// One-stop orchestrator for the mesh substrate. Owns:
//   * the Core daemon (Python child process)
//   * the host_notifications node (Node.js child process)
//   * the shell's MeshNode client (used by the renderer's mesh.invoke())
//
// The shell node never registers a stream — it has no inbound surfaces in
// v0.1.0 — so `MeshNode.start()` is intentionally not called. The SDK's
// .invoke() does not require a session.

let secrets: MeshSecrets | null = null
let coreManager: CoreManager | null = null
let nodeManager: NodeManager | null = null
let shellNode: MeshNode | null = null

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

export async function startMesh(): Promise<void> {
  if (coreManager) return
  secrets = generateMeshSecrets()
  coreManager = new CoreManager({ secrets })
  await coreManager.ensureRunning()
  shellNode = new MeshNode('shell', secrets.shellSecret, coreManager.url)
  nodeManager = new NodeManager({ secrets, coreUrl: coreManager.url })
  await nodeManager.startAll()
}

export async function stopMesh(): Promise<void> {
  // Stop nodes first so they unregister cleanly before Core goes away.
  await nodeManager?.stopAll()
  nodeManager = null
  shellNode = null
  await coreManager?.stop()
  coreManager = null
  secrets = null
}

export function getCoreUrl(): string | null {
  return coreManager?.url ?? null
}

export async function isCoreHealthy(): Promise<boolean> {
  return (await coreManager?.health()) ?? false
}

export async function meshInvoke(
  target: string,
  payload: Record<string, unknown>,
): Promise<MeshInvokeResult> {
  const node = shellNode
  if (!node) {
    return {
      ok: false,
      error: { status: null, message: 'mesh not started' },
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
            message: typeof env.payload?.reason === 'string'
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
