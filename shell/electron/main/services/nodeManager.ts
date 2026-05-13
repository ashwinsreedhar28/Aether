import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync, createWriteStream, type WriteStream } from 'node:fs'
import { existsSync } from 'node:fs'
import {
  HOST_NOTIFICATIONS_ENTRY,
  NEWS_FEEDS_ENTRY,
  NODE_LOG_FILE,
  NODE_PID_FILE,
  meshRuntimeDir,
  nodeDataDir,
} from './paths'
import type { MeshSecrets } from './secrets'

const SHUTDOWN_GRACE_MS = 3_000

interface NodeProc {
  id: string
  proc: ChildProcess
  log: WriteStream
}

interface NodeSpawnSpec {
  id: string
  entry: string
  buildHint: string
  /** Additional per-node env on top of MESH_CORE_URL + MESH_<ID>_SECRET. */
  extraEnv?: NodeJS.ProcessEnv
  /** Per-node secret env-var name and value. */
  secretEnvName: string
  secretValue: string
}

// Spawns Node.js mesh nodes (host_notifications, news_feeds, …). Each
// node registers itself with Core on start — we don't health-check from
// here. If a node fails to register, that's surfaced in its log file.
// Nodes that publish their own liveness marker (news_feeds writes
// $HOMEOS_DATA_DIR/news_feeds/running) are the canonical signal for
// "this node is signed in"; the shell does not poll those today.
export class NodeManager {
  private readonly secrets: MeshSecrets
  private readonly coreUrl: string
  private readonly nodes = new Map<string, NodeProc>()

  constructor(opts: { secrets: MeshSecrets; coreUrl: string }) {
    this.secrets = opts.secrets
    this.coreUrl = opts.coreUrl
  }

  async startAll(): Promise<void> {
    mkdirSync(meshRuntimeDir(), { recursive: true })
    // Parallel: each node only depends on Core (already up), not on each
    // other. Doing them sequentially would add ~register-latency × N to
    // every cold start for no benefit.
    await Promise.all([this.spawnHostNotifications(), this.spawnNewsFeeds()])
  }

  private async spawnHostNotifications(): Promise<void> {
    await this.spawnNode({
      id: 'host_notifications',
      entry: HOST_NOTIFICATIONS_ENTRY,
      buildHint: '`pnpm --filter @homeos/host-notifications build`',
      secretEnvName: 'MESH_HOST_NOTIFICATIONS_SECRET',
      secretValue: this.secrets.hostNotificationsSecret,
    })
  }

  private async spawnNewsFeeds(): Promise<void> {
    const dataDir = nodeDataDir()
    mkdirSync(dataDir, { recursive: true })
    await this.spawnNode({
      id: 'news_feeds',
      entry: NEWS_FEEDS_ENTRY,
      buildHint: '`pnpm --filter @homeos/news-feeds build`',
      secretEnvName: 'MESH_NEWS_FEEDS_SECRET',
      secretValue: this.secrets.newsFeedsSecret,
      // The node persists SQLite + the running marker under this root.
      // app.getPath is unreachable from the child, so we pass it in.
      extraEnv: { HOMEOS_DATA_DIR: dataDir },
    })
  }

  private async spawnNode(spec: NodeSpawnSpec): Promise<void> {
    if (!existsSync(spec.entry)) {
      throw new Error(
        `${spec.id} dist not found at ${spec.entry}. Run ${spec.buildHint} and retry.`,
      )
    }
    const log = createWriteStream(NODE_LOG_FILE(spec.id), { flags: 'a' })
    log.write(`\n--- ${spec.id} spawn @ ${new Date().toISOString()} ---\n`)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...spec.extraEnv,
      MESH_CORE_URL: this.coreUrl,
      [spec.secretEnvName]: spec.secretValue,
    }
    const proc = spawn('node', [spec.entry], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (proc.pid !== undefined) {
      writeFileSync(NODE_PID_FILE(spec.id), String(proc.pid))
    }
    proc.stdout?.pipe(log, { end: false })
    proc.stderr?.pipe(log, { end: false })
    proc.on('exit', (code, sig) => {
      log.write(`--- ${spec.id} exited code=${code} signal=${sig ?? ''} ---\n`)
    })
    this.nodes.set(spec.id, { id: spec.id, proc, log })
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
