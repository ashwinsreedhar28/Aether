import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync, createWriteStream, type WriteStream } from 'node:fs'
import { existsSync } from 'node:fs'
import {
  HOST_NOTIFICATIONS_ENTRY,
  NODE_LOG_FILE,
  NODE_PID_FILE,
  meshRuntimeDir,
} from './paths'
import type { MeshSecrets } from './secrets'

const SHUTDOWN_GRACE_MS = 3_000

interface NodeProc {
  id: string
  proc: ChildProcess
  log: WriteStream
}

// Spawns Node.js mesh nodes (host_notifications today, more later). Each
// node registers itself with Core on start — we don't health-check from here.
// If a node fails to register, that's surfaced in its log file.
export class NodeManager {
  private readonly secrets: MeshSecrets
  private readonly coreUrl: string
  private readonly nodes = new Map<string, NodeProc>()

  constructor(opts: { secrets: MeshSecrets; coreUrl: string }) {
    this.secrets = opts.secrets
    this.coreUrl = opts.coreUrl
  }

  async startAll(): Promise<void> {
    await this.spawnHostNotifications()
  }

  private async spawnHostNotifications(): Promise<void> {
    if (!existsSync(HOST_NOTIFICATIONS_ENTRY)) {
      throw new Error(
        `host_notifications dist not found at ${HOST_NOTIFICATIONS_ENTRY}. ` +
          `Run \`pnpm --filter @homeos/host-notifications build\` and retry.`,
      )
    }
    mkdirSync(meshRuntimeDir(), { recursive: true })
    const id = 'host_notifications'
    const log = createWriteStream(NODE_LOG_FILE(id), { flags: 'a' })
    log.write(`\n--- ${id} spawn @ ${new Date().toISOString()} ---\n`)

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MESH_CORE_URL: this.coreUrl,
      MESH_HOST_NOTIFICATIONS_SECRET: this.secrets.hostNotificationsSecret,
    }
    const proc = spawn('node', [HOST_NOTIFICATIONS_ENTRY], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (proc.pid !== undefined) {
      writeFileSync(NODE_PID_FILE(id), String(proc.pid))
    }
    proc.stdout?.pipe(log, { end: false })
    proc.stderr?.pipe(log, { end: false })
    proc.on('exit', (code, sig) => {
      log.write(`--- ${id} exited code=${code} signal=${sig ?? ''} ---\n`)
    })
    this.nodes.set(id, { id, proc, log })
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.nodes.keys()).map((id) => this.stop(id)))
  }

  async stop(id: string): Promise<void> {
    const entry = this.nodes.get(id)
    if (!entry) return
    this.nodes.delete(id)
    if (entry.proc.exitCode !== null) {
      entry.log.end()
      return
    }
    try {
      entry.proc.kill('SIGTERM')
    } catch {
      /* already gone */
    }
    const gentleExit = await waitForExit(entry.proc, SHUTDOWN_GRACE_MS)
    if (!gentleExit) {
      try {
        entry.proc.kill('SIGKILL')
      } catch {
        /* gone */
      }
      await waitForExit(entry.proc, 2_000)
    }
    entry.log.end()
  }
}

function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    proc.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}
