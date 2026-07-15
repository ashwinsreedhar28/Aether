import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { MeshNode, MeshDeny, type Envelope } from '@aether/mesh-node-sdk'

const execFileP = promisify(execFile)

const NODE_ID = 'host_notifications'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

interface NotifyPayload {
  title: string
  body: string
  urgent?: boolean
}

// AppleScript strings are double-quoted; backslashes and double quotes have
// to be escaped before interpolation. execFile (vs exec) keeps the shell out
// of the loop, so we don't have to worry about /bin/sh metacharacters.
function escapeApplescriptString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function fireMacNotification(payload: NotifyPayload): Promise<void> {
  const safeBody = escapeApplescriptString(payload.body)
  const safeTitle = escapeApplescriptString(payload.title)
  const sound = payload.urgent ? ' sound name "Glass"' : ''
  const script = `display notification "${safeBody}" with title "${safeTitle}"${sound}`
  await execFileP('osascript', ['-e', script])
}

async function handleNotify(env: Envelope): Promise<Record<string, unknown>> {
  if (process.platform !== 'darwin') {
    throw new MeshDeny('host_notifications_unsupported', {
      platform: process.platform,
      detail: 'macOS-only in v0.1.0; Windows path is a follow-up PR',
    })
  }
  const payload = env.payload as Partial<NotifyPayload>
  if (typeof payload.title !== 'string' || typeof payload.body !== 'string') {
    // Belt-and-braces: Core already validated against the JSON Schema, but
    // throwing MeshDeny here keeps the error envelope structured rather than
    // letting an undefined slip into the AppleScript template.
    throw new MeshDeny('host_notifications_bad_payload', {
      have: { title: typeof payload.title, body: typeof payload.body },
    })
  }
  const startedAt = new Date().toISOString()
  try {
    await fireMacNotification({
      title: payload.title,
      body: payload.body,
      urgent: payload.urgent === true,
    })
  } catch (e) {
    throw new MeshDeny('host_notifications_osascript_failed', {
      details: (e as Error).message,
    })
  }
  return { delivered: true, at: startedAt }
}

async function main(): Promise<void> {
  const secret = process.env.MESH_HOST_NOTIFICATIONS_SECRET
  if (!secret) {
    process.stderr.write(
      `[${NODE_ID}] MESH_HOST_NOTIFICATIONS_SECRET is required; refusing to start.\n`,
    )
    process.exit(2)
  }
  const node = new MeshNode(NODE_ID, secret, CORE_URL)
  node.on('notify', handleNotify)
  await node.start()
  process.stdout.write(`[${NODE_ID}] registered with core at ${CORE_URL}\n`)

  const shutdown = async (sig: NodeJS.Signals): Promise<void> => {
    process.stdout.write(`[${NODE_ID}] received ${sig}, stopping\n`)
    try {
      await node.stop()
    } catch {
      /* best-effort */
    }
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  process.stderr.write(`[${NODE_ID}] fatal: ${(err as Error).stack ?? err}\n`)
  process.exit(1)
})
