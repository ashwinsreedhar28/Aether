import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync, createWriteStream, type WriteStream } from 'node:fs'
import { existsSync } from 'node:fs'
import {
  DIGEST_ENTRY,
  FINANCE_ENTRY,
  HOST_NOTIFICATIONS_ENTRY,
  NEWS_FEEDS_ENTRY,
  SYSTEM_INFO_ENTRY,
  WEATHER_ENTRY,
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
// $AETHER_DATA_DIR/news_feeds/running) are the canonical signal for
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
    await Promise.all([
      this.spawnHostNotifications(),
      this.spawnNewsFeeds(),
      this.spawnFinance(),
      this.spawnDigest(),
      this.spawnWeather(),
      this.spawnSystemInfo(),
    ])
  }

  private async spawnHostNotifications(): Promise<void> {
    await this.spawnNode({
      id: 'host_notifications',
      entry: HOST_NOTIFICATIONS_ENTRY,
      buildHint: '`pnpm --filter @aether/host-notifications build`',
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
      buildHint: '`pnpm --filter @aether/news-feeds build`',
      secretEnvName: 'MESH_NEWS_FEEDS_SECRET',
      secretValue: this.secrets.newsFeedsSecret,
      // The node persists SQLite + the running marker under this root.
      // app.getPath is unreachable from the child, so we pass it in.
      extraEnv: { AETHER_DATA_DIR: dataDir },
    })
  }

  private async spawnDigest(): Promise<void> {
    // First composer node — fans out to news_feeds + finance and back
    // into host_notifications for scheduled briefings. No DB; the
    // marker file under AETHER_DATA_DIR matches the data-node pattern
    // for liveness consistency.
    const dataDir = nodeDataDir()
    mkdirSync(dataDir, { recursive: true })
    await this.spawnNode({
      id: 'digest',
      entry: DIGEST_ENTRY,
      buildHint: '`pnpm --filter @aether/digest build`',
      secretEnvName: 'MESH_DIGEST_SECRET',
      secretValue: this.secrets.digestSecret,
      extraEnv: { AETHER_DATA_DIR: dataDir },
    })
  }

  private async spawnFinance(): Promise<void> {
    // No API key required as of v0.3.x — the node fetches via Yahoo
    // Finance (primary) and Stooq (fallback), both anonymous endpoints.
    const dataDir = nodeDataDir()
    mkdirSync(dataDir, { recursive: true })
    await this.spawnNode({
      id: 'finance',
      entry: FINANCE_ENTRY,
      buildHint: '`pnpm --filter @aether/finance build`',
      secretEnvName: 'MESH_FINANCE_SECRET',
      secretValue: this.secrets.financeSecret,
      // AETHER_DATA_DIR is the writable root for the running marker (no
      // SQLite — quotes live in-memory).
      extraEnv: {
        AETHER_DATA_DIR: dataDir,
      },
    })
  }

  private async spawnWeather(): Promise<void> {
    // Weather node — polls Open-Meteo every 15 minutes for current
    // conditions + 7-day forecast. No API key. Requires
    // AETHER_WEATHER_LAT/LON/LABEL env vars; the node itself starts in
    // graceful-degradation mode if they are unset (returns
    // available: false on both surfaces). Those env vars flow through
    // ...process.env on the spawn line in spawnNode below.
    // AETHER_DATA_DIR is the writable root for the running marker
    // (no persistent state — readings live in-memory only).
    const dataDir = nodeDataDir()
    mkdirSync(dataDir, { recursive: true })
    await this.spawnNode({
      id: 'weather',
      entry: WEATHER_ENTRY,
      buildHint: '`pnpm --filter @aether/weather build`',
      secretEnvName: 'MESH_WEATHER_SECRET',
      secretValue: this.secrets.weatherSecret,
      extraEnv: { AETHER_DATA_DIR: dataDir },
    })
  }

  private async spawnSystemInfo(): Promise<void> {
    // System info node — exposes macOS system status (battery, disk,
    // network, active app) via native shell commands. No API key. No
    // special permissions required beyond standard shell access.
    // AETHER_DATA_DIR is the writable root for the running marker
    // (no persistent state — readings are cached in-memory 5-15s).
    const dataDir = nodeDataDir()
    mkdirSync(dataDir, { recursive: true })
    await this.spawnNode({
      id: 'system_info',
      entry: SYSTEM_INFO_ENTRY,
      buildHint: '`pnpm --filter @aether/system-info build`',
      secretEnvName: 'MESH_SYSTEM_INFO_SECRET',
      secretValue: this.secrets.systemInfoSecret,
      extraEnv: { AETHER_DATA_DIR: dataDir },
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
