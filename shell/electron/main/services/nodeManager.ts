import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync, createWriteStream, type WriteStream } from 'node:fs'
import { existsSync } from 'node:fs'
import {
  CLIPBOARD_HISTORY_ENTRY,
  DIGEST_ENTRY,
  FINANCE_ENTRY,
  GITHUB_ENTRY,
  HOST_NOTIFICATIONS_ENTRY,
  INTENTS_ENTRY,
  LANES_ENTRY,
  MACOS_MAIL_ENTRY,
  MACOS_MESSAGES_ENTRY,
  MESH_INTROSPECTION_ENTRY,
  NEWS_FEEDS_ENTRY,
  SYSTEM_INFO_ENTRY,
  TIME_ENTRY,
  WEATHER_ENTRY,
  NODE_LOG_FILE,
  NODE_PID_FILE,
  meshRuntimeDir,
  nodeDataDir,
} from './paths'
import type { MeshSecrets } from './secrets'
import { warnIfDistStale } from './staleDist'
import { isQuitting } from './appLifecycle'

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
      this.spawnClipboardHistory(),
      this.spawnMacosMessages(),
      this.spawnMacosMail(),
      this.spawnTime(),
      this.spawnMeshIntrospection(),
      // visualizer is deliberately NOT spawned on desktop (ruling 2026-06-09,
      // issue #220): the Viewer workspace store is the layout authority here,
      // so the node's panel-POST half is dead on this surface. The node code
      // (nodes/visualizer), its manifest entry, and the reserved
      // shell → visualizer.render edge all stay for the AVP track; reviving
      // it there means re-adding a spawn call (spawnVisualizer in git
      // history), not rebuilding the node.
      this.spawnLanes(),
      this.spawnIntents(),
      this.spawnGithub(),
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

  private async spawnClipboardHistory(): Promise<void> {
    // Clipboard history node — polls macOS clipboard at 500ms via
    // pbpaste, SHA-256 content-hash dedup via an in-memory ring buffer
    // plus SQLite UNIQUE, per-node SQLite for persistence, retention
    // 1000. AETHER_DATA_DIR is the writable root for the running marker
    // + clipboard.db.
    const dataDir = nodeDataDir()
    mkdirSync(dataDir, { recursive: true })
    await this.spawnNode({
      id: 'clipboard_history',
      entry: CLIPBOARD_HISTORY_ENTRY,
      buildHint: '`pnpm --filter @aether/clipboard-history build`',
      secretEnvName: 'MESH_CLIPBOARD_HISTORY_SECRET',
      secretValue: this.secrets.clipboardHistorySecret,
      extraEnv: { AETHER_DATA_DIR: dataDir },
    })
  }

  private async spawnMacosMessages(): Promise<void> {
    // macos_messages node — reads ~/Library/Messages/chat.db read-only
    // every 30s, per-chat watermark on date_delivered, composite
    // (chat_id, message_id) dedup, per-node SQLite mirror. Needs Full
    // Disk Access; the daemon stays up and logs gracefully on EACCES
    // until permission is granted. AETHER_DATA_DIR is the writable root
    // for the running marker + messages.db.
    const dataDir = nodeDataDir()
    mkdirSync(dataDir, { recursive: true })
    await this.spawnNode({
      id: 'macos_messages',
      entry: MACOS_MESSAGES_ENTRY,
      buildHint: '`pnpm --filter @aether/macos-messages build`',
      secretEnvName: 'MESH_MACOS_MESSAGES_SECRET',
      secretValue: this.secrets.macosMessagesSecret,
      extraEnv: { AETHER_DATA_DIR: dataDir },
    })
  }

  private async spawnMacosMail(): Promise<void> {
    // macos_mail node — polls Mail.app inbox every 60s via the
    // @aether/macos-applescript bridge, dedupes by message UID,
    // mirrors to per-node SQLite. Requires Mail.app Automation
    // permission; the daemon stays up and logs once on denial, then
    // retries silently until permission is granted. AETHER_DATA_DIR
    // is the writable root for the running marker + mail.db.
    const dataDir = nodeDataDir()
    mkdirSync(dataDir, { recursive: true })
    await this.spawnNode({
      id: 'macos_mail',
      entry: MACOS_MAIL_ENTRY,
      buildHint: '`pnpm --filter @aether/macos-mail build`',
      secretEnvName: 'MESH_MACOS_MAIL_SECRET',
      secretValue: this.secrets.macosMailSecret,
      extraEnv: { AETHER_DATA_DIR: dataDir },
    })
  }

  private async spawnTime(): Promise<void> {
    // time node — stateless timezone-aware clock. No SQLite, no
    // poller — one Intl.DateTimeFormat per invocation. AETHER_DATA_DIR
    // is the writable root for the running marker only (matches the
    // daemon-node liveness pattern; no other persistence).
    const dataDir = nodeDataDir()
    mkdirSync(dataDir, { recursive: true })
    await this.spawnNode({
      id: 'time',
      entry: TIME_ENTRY,
      buildHint: '`pnpm --filter @aether/time build`',
      secretEnvName: 'MESH_TIME_SECRET',
      secretValue: this.secrets.timeSecret,
      extraEnv: { AETHER_DATA_DIR: dataDir },
    })
  }

  private async spawnMeshIntrospection(): Promise<void> {
    // mesh_introspection sensor — polls Core's bearer-gated
    // /__introspection__ at 2s cadence and re-exposes topology +
    // activity as signed mesh surfaces. Unlike the other data nodes it
    // needs ADMIN_TOKEN in its env to authenticate to that endpoint;
    // process.env on the shell main process does NOT carry it (it's a
    // per-launch secret minted in generateMeshSecrets), so it must be
    // injected explicitly via extraEnv. AETHER_DATA_DIR is the writable
    // root for the running marker, matching the daemon-node pattern.
    const dataDir = nodeDataDir()
    mkdirSync(dataDir, { recursive: true })
    await this.spawnNode({
      id: 'mesh_introspection',
      entry: MESH_INTROSPECTION_ENTRY,
      buildHint: '`pnpm --filter @aether/mesh-introspection build`',
      secretEnvName: 'MESH_MESH_INTROSPECTION_SECRET',
      secretValue: this.secrets.meshIntrospectionSecret,
      extraEnv: {
        ADMIN_TOKEN: this.secrets.adminToken,
        AETHER_DATA_DIR: dataDir,
      },
    })
  }

  private async spawnLanes(): Promise<void> {
    // lanes Sensor — polls `git worktree list` for the shared repo and exposes
    // active/idle lane state via lanes.status. It needs no ADMIN_TOKEN (no
    // broker endpoint); it derives the repo root from its own
    // compiled path, so it works in any worktree. AETHER_DATA_DIR is the
    // writable root for the running marker, matching the data-node pattern.
    const dataDir = nodeDataDir()
    mkdirSync(dataDir, { recursive: true })
    await this.spawnNode({
      id: 'lanes',
      entry: LANES_ENTRY,
      buildHint: '`pnpm --filter @aether/lanes build`',
      secretEnvName: 'MESH_LANES_SECRET',
      secretValue: this.secrets.lanesSecret,
      extraEnv: {
        AETHER_DATA_DIR: dataDir,
      },
    })
  }

  private async spawnIntents(): Promise<void> {
    // intents — the gap sensor. Persists gap records (requests Aether could
    // not fulfil) to an append-only JSONL log under AETHER_DATA_DIR, and
    // serves them back via intents.list. The first node whose persisted data
    // is mesh-authored rather than a re-fetchable cache — AETHER_DATA_DIR is
    // the writable root for both gaps.jsonl and the running marker.
    const dataDir = nodeDataDir()
    mkdirSync(dataDir, { recursive: true })
    await this.spawnNode({
      id: 'intents',
      entry: INTENTS_ENTRY,
      buildHint: '`pnpm --filter @aether/intents build`',
      secretEnvName: 'MESH_INTENTS_SECRET',
      secretValue: this.secrets.intentsSecret,
      extraEnv: {
        AETHER_DATA_DIR: dataDir,
      },
    })
  }

  private async spawnGithub(): Promise<void> {
    // github Actor — files gaps as GitHub issues (create_issue dedups inside)
    // and serves the open issue board (list_issues). AETHER_GITHUB_TOKEN and
    // AETHER_GITHUB_REPO ride the inherited process env (.env.local via
    // env-loader); a missing token is handled by the node itself (degraded
    // no-token mode), so the spawn is unconditional. AETHER_DATA_DIR is the
    // writable root for the running marker, matching the data-node pattern.
    const dataDir = nodeDataDir()
    mkdirSync(dataDir, { recursive: true })
    await this.spawnNode({
      id: 'github',
      entry: GITHUB_ENTRY,
      buildHint: '`pnpm --filter @aether/github build`',
      secretEnvName: 'MESH_GITHUB_SECRET',
      secretValue: this.secrets.githubSecret,
      extraEnv: {
        AETHER_DATA_DIR: dataDir,
      },
    })
  }

  private async spawnNode(spec: NodeSpawnSpec): Promise<void> {
    // Don't launch a node into a shell that's already tearing down. startAll()
    // fans out in parallel and a quit can land mid-flight; a node spawned now
    // would orphan past the app (the same race the raven manager guards).
    if (isQuitting()) {
      console.warn(`[nodeManager] skipping ${spec.id} spawn — app is quitting`)
      return
    }
    if (!existsSync(spec.entry)) {
      throw new Error(
        `${spec.id} dist not found at ${spec.entry}. Run ${spec.buildHint} and retry.`,
      )
    }
    // Dist exists — but it may be stale relative to src/ (install ≠ build).
    // Warn loudly so we don't silently spawn old code; never block the spawn.
    warnIfDistStale(spec.entry)
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
