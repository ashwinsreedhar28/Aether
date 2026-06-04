import { spawn, type ChildProcess } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  createWriteStream,
  type WriteStream,
} from 'node:fs'
import { dirname } from 'node:path'
import {
  CORE_VENDOR_DIR,
  MANIFEST_PATH,
  CORE_PID_FILE,
  CORE_LOG_FILE,
  CORE_AUDIT_FILE,
  meshRuntimeDir,
} from './paths'
import { resolvePython3 } from './python'
import type { MeshSecrets } from './secrets'

// Daemon manager for the Python RAVEN_MESH Core. Pattern adapted from
// _ingest/VIEWER/apps/viewer/electron/main/services/daemonManager.ts, with
// the simplifications called for by CLAUDE.md §11 heuristic 8:
//   * single port (no auto-discovery)
//   * no PID-file revival across runs — we always spawn fresh per launch
//   * no production-path search (dev-only for v0.1.0)
//   * synchronous stdout/stderr piped to a single rotating-free log file

const HOST = '127.0.0.1'
const PORT = 8000
const HEALTH_TIMEOUT_MS = 30_000
const HEALTH_POLL_INTERVAL_MS = 250
const SHUTDOWN_GRACE_MS = 5_000

export interface CoreManagerOptions {
  secrets: MeshSecrets
}

export class CoreManager {
  readonly host = HOST
  readonly port = PORT
  readonly url = `http://${HOST}:${PORT}`
  private readonly secrets: MeshSecrets
  private proc: ChildProcess | null = null
  private logStream: WriteStream | null = null

  constructor(opts: CoreManagerOptions) {
    this.secrets = opts.secrets
  }

  async ensureRunning(): Promise<void> {
    // If something else is already serving the port (e.g. a manually-started
    // Core during dev), reuse it. The mesh works fine; only quit hygiene
    // differs (we won't try to SIGTERM a Core we didn't spawn).
    if (await this.healthOnce()) return

    // Pre-flight: Node's spawn reports ENOENT against the executable when
    // the cwd or any path arg is missing, which is misleading. Check first.
    if (!existsSync(CORE_VENDOR_DIR)) {
      throw new Error(
        `Core vendor dir not found at ${CORE_VENDOR_DIR}. ` +
          `Re-run the install / vendor step; see core/README.md.`,
      )
    }
    if (!existsSync(MANIFEST_PATH)) {
      throw new Error(`manifest.yaml not found at ${MANIFEST_PATH}.`)
    }

    mkdirSync(meshRuntimeDir(), { recursive: true })
    mkdirSync(dirname(CORE_AUDIT_FILE()), { recursive: true })
    this.logStream = createWriteStream(CORE_LOG_FILE(), { flags: 'a' })
    this.logStream.write(`\n--- core spawn @ ${new Date().toISOString()} ---\n`)

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ADMIN_TOKEN: this.secrets.adminToken,
      MESH_CORE_SECRET: this.secrets.coreSecret,
      MESH_SHELL_SECRET: this.secrets.shellSecret,
      MESH_HOST_NOTIFICATIONS_SECRET: this.secrets.hostNotificationsSecret,
      // Raven (the voice daemon) is spawned by ravenDaemonManager — not
      // by this manager — but Core has to resolve env:MESH_RAVEN_SECRET
      // against the same value when it loads the manifest at startup,
      // so both children receive it from the shared MeshSecrets bag.
      MESH_RAVEN_SECRET: this.secrets.ravenSecret,
      // Same shape for news_feeds: spawned by nodeManager, but Core
      // resolves env:MESH_NEWS_FEEDS_SECRET against the same value at
      // manifest load.
      MESH_NEWS_FEEDS_SECRET: this.secrets.newsFeedsSecret,
      // And the same for finance — Core needs the secret in its
      // environment at manifest-load so the env:MESH_FINANCE_SECRET
      // reference resolves to the same hex-32 that nodeManager will
      // inject into the finance child's env.
      MESH_FINANCE_SECRET: this.secrets.financeSecret,
      // Digest is the first composer node (fans out to news_feeds +
      // finance and back into host_notifications). Same env contract
      // as the data nodes — Core resolves env:MESH_DIGEST_SECRET at
      // manifest load.
      MESH_DIGEST_SECRET: this.secrets.digestSecret,
      // Weather is the second data node (provides current conditions +
      // forecast). Same env contract — Core resolves env:MESH_WEATHER_SECRET
      // at manifest load so nodeManager can inject the same value into the
      // weather child's env.
      MESH_WEATHER_SECRET: this.secrets.weatherSecret,
      // Vision is the camera-capture Python daemon (spawned by
      // visionDaemonManager, not nodeManager). Same env contract — Core
      // resolves env:MESH_VISION_SECRET at manifest load so that
      // visionDaemonManager and Core agree on the secret value.
      MESH_VISION_SECRET: this.secrets.visionSecret,
      // Calendar is the macOS Calendar.app integration Python daemon (spawned
      // by calendarDaemonManager, not nodeManager). Same env contract — Core
      // resolves env:MESH_CALENDAR_SECRET at manifest load so that
      // calendarDaemonManager and Core agree on the secret value.
      MESH_CALENDAR_SECRET: this.secrets.calendarSecret,
      // Reminders is the macOS Reminders.app integration Python daemon (spawned
      // by remindersDaemonManager, not nodeManager). Same env contract — Core
      // resolves env:MESH_REMINDERS_SECRET at manifest load so that
      // remindersDaemonManager and Core agree on the secret value.
      MESH_REMINDERS_SECRET: this.secrets.remindersSecret,
      // System info is a TypeScript data node (spawned by nodeManager).
      // Same env contract — Core resolves env:MESH_SYSTEM_INFO_SECRET at
      // manifest load so nodeManager can inject the same value into the
      // system_info child's env.
      MESH_SYSTEM_INFO_SECRET: this.secrets.systemInfoSecret,
      // Clipboard history is a TypeScript data node (spawned by nodeManager).
      // Same env contract — Core resolves env:MESH_CLIPBOARD_HISTORY_SECRET at
      // manifest load so nodeManager can inject the same value into the
      // clipboard_history child's env.
      MESH_CLIPBOARD_HISTORY_SECRET: this.secrets.clipboardHistorySecret,
      // macOS messages is a TypeScript data node (spawned by nodeManager).
      // Same env contract — Core resolves env:MESH_MACOS_MESSAGES_SECRET at
      // manifest load so nodeManager can inject the same value into the
      // macos_messages child's env.
      MESH_MACOS_MESSAGES_SECRET: this.secrets.macosMessagesSecret,
      // macOS mail is a TypeScript data node (spawned by nodeManager).
      // Uses the @aether/macos-applescript bridge for Mail.app inbox
      // queries. Same env contract — Core resolves env:MESH_MACOS_MAIL_SECRET
      // at manifest load so nodeManager can inject the same value into
      // the macos_mail child's env.
      MESH_MACOS_MAIL_SECRET: this.secrets.macosMailSecret,
      // Time is a stateless TypeScript data node (spawned by nodeManager).
      // Same env contract — Core resolves env:MESH_TIME_SECRET at
      // manifest load so nodeManager can inject the same value into
      // the time child's env.
      MESH_TIME_SECRET: this.secrets.timeSecret,
      // Mesh introspection is a TypeScript sensor node (spawned by
      // nodeManager). Same env contract — Core resolves
      // env:MESH_MESH_INTROSPECTION_SECRET at manifest load so
      // nodeManager can inject the same value into the child's env.
      // The node ALSO needs ADMIN_TOKEN (injected by nodeManager via
      // extraEnv) to authenticate to Core's bearer-gated
      // /__introspection__ endpoint — that token is the same
      // this.secrets.adminToken already in Core's env above.
      MESH_MESH_INTROSPECTION_SECRET: this.secrets.meshIntrospectionSecret,
      // Visualizer is a TypeScript Mixer node (spawned by nodeManager).
      // Same env contract — Core resolves env:MESH_VISUALIZER_SECRET at
      // manifest load so nodeManager can inject the same value into the
      // child's env. No ADMIN_TOKEN: the visualizer reads mesh state via
      // mesh.invoke(mesh_introspection.topology), not the broker endpoint.
      MESH_VISUALIZER_SECRET: this.secrets.visualizerSecret,
      // Lanes is a TypeScript Sensor node (spawned by nodeManager). Same env
      // contract — Core resolves env:MESH_LANES_SECRET at manifest load so
      // nodeManager can inject the same value into the child's env. No
      // ADMIN_TOKEN: lanes reads only local git state, no broker endpoint.
      MESH_LANES_SECRET: this.secrets.lanesSecret,
      // intents is a TypeScript Sensor node (the gap sensor, spawned by
      // nodeManager). Same env contract — Core resolves env:MESH_INTENTS_SECRET
      // at manifest load so nodeManager can inject the same value into the
      // child's env. No ADMIN_TOKEN: it persists gaps locally, no broker endpoint.
      MESH_INTENTS_SECRET: this.secrets.intentsSecret,
    }
    const pythonBin = resolvePython3()
    this.logStream.write(`[coreManager] python3 → ${pythonBin}\n`)
    this.proc = spawn(
      pythonBin,
      [
        '-m',
        'core.core',
        '--manifest',
        MANIFEST_PATH,
        '--host',
        HOST,
        '--port',
        String(PORT),
        '--audit-log',
        CORE_AUDIT_FILE(),
      ],
      {
        cwd: CORE_VENDOR_DIR,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    if (this.proc.pid !== undefined) {
      writeFileSync(CORE_PID_FILE(), String(this.proc.pid))
    }
    this.proc.stdout?.pipe(this.logStream, { end: false })
    this.proc.stderr?.pipe(this.logStream, { end: false })
    this.proc.on('exit', (code, sig) => {
      this.logStream?.write(`--- core exited code=${code} signal=${sig ?? ''} ---\n`)
    })

    const ok = await this.waitForHealth(HEALTH_TIMEOUT_MS)
    if (!ok) {
      // Pull whatever stderr we have buffered to surface in the error
      // dialog. The log file always has the full output.
      try {
        this.proc?.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      throw new Error(
        `Core failed to become healthy within ${HEALTH_TIMEOUT_MS / 1000}s. ` +
          `Inspect ${CORE_LOG_FILE()} for the spawn output.`,
      )
    }
  }

  isOwnedSpawn(): boolean {
    return this.proc !== null && this.proc.exitCode === null
  }

  async health(): Promise<boolean> {
    return this.healthOnce()
  }

  private async healthOnce(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/v0/healthz`, {
        signal: AbortSignal.timeout(1500),
      })
      return res.status === 200
    } catch {
      return false
    }
  }

  private async waitForHealth(timeoutMs: number): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await this.healthOnce()) return true
      if (this.proc?.exitCode !== null && this.proc?.exitCode !== undefined) {
        // Core already exited; no point polling further.
        return false
      }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS))
    }
    return false
  }

  async stop(): Promise<void> {
    if (!this.proc) return
    const proc = this.proc
    this.proc = null
    if (proc.exitCode !== null) {
      this.logStream?.end()
      this.logStream = null
      return
    }
    // SIGTERM → wait for graceful exit. If the grace expires, escalate to
    // SIGKILL and wait again. Resolving the outer promise after the second
    // wait ensures the parent doesn't quit while the OS is mid-reap.
    try {
      proc.kill('SIGTERM')
    } catch {
      /* already gone */
    }
    const gentleExit = await waitForExit(proc, SHUTDOWN_GRACE_MS)
    if (!gentleExit) {
      try {
        proc.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      await waitForExit(proc, 2_000)
    }
    this.logStream?.end()
    this.logStream = null
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
