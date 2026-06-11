/**
 * Node Registry — registerNode() factory pattern
 *
 * Consolidates the 6-file Python daemon node registration pattern (and 5-file
 * TS node pattern) into a single registration call per node. Eliminates
 * boilerplate across daemon managers, secrets, mesh config getters, and
 * index.ts wiring.
 *
 * Design trade-offs (see DECISIONS.md "registerNode factory pattern"):
 * - Uses a shared PythonDaemonManager<TConfig> generic class instead of
 *   per-node XxxDaemonManager classes. Node-specific config (id, directory,
 *   bootstrap check) is passed at construction time.
 * - TypeScript nodes continue to use nodeManager.ts pattern but with
 *   declarative registration via registerTsNode().
 * - Secrets are generated lazily on first registerNode() call and stored in
 *   a module-level registry. The generateMeshSecrets() function becomes a
 *   compatibility shim over this registry.
 * - Mesh config getters (getRemindersMeshConfig, etc.) are generated
 *   dynamically by the factory and exported via a getNodeMeshConfig(id)
 *   lookup function.
 *
 * Future work: migrate remaining daemon managers (raven, vision, calendar) to
 * this pattern in follow-up PRs. Reminders is the proof-of-concept.
 */

import { spawn, spawnSync, ChildProcess } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { app } from 'electron'
import { pickBinaryLine } from './shellCapture'

// ----------------------------------------------------------------------------
// Secret Registry
// ----------------------------------------------------------------------------

const secretRegistry = new Map<string, string>()

function hex32(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Generate or retrieve a node secret. Secrets are generated once per node ID
 * and cached for the lifetime of the process.
 */
export function getNodeSecret(nodeId: string): string {
  let secret = secretRegistry.get(nodeId)
  if (!secret) {
    secret = hex32()
    secretRegistry.set(nodeId, secret)
  }
  return secret
}

/**
 * Get all registered node secrets as a Record. Used by generateMeshSecrets()
 * compatibility shim.
 */
export function getAllNodeSecrets(): Record<string, string> {
  return Object.fromEntries(secretRegistry.entries())
}

// ----------------------------------------------------------------------------
// Mesh Config Registry
// ----------------------------------------------------------------------------

type MeshConfig = { coreUrl: string; secret: string }
type MeshState = 'idle' | 'starting' | 'ready' | 'failed'

let meshState: MeshState = 'idle'
let coreUrl: string | null = null

/**
 * Update mesh state. Called by mesh.ts when the mesh transitions to ready.
 */
export function setMeshReady(url: string): void {
  meshState = 'ready'
  coreUrl = url
}

/**
 * Get mesh config for a specific node. Returns null if mesh is not ready.
 */
export function getNodeMeshConfig(nodeId: string): MeshConfig | null {
  if (meshState !== 'ready' || !coreUrl) return null
  return { coreUrl, secret: getNodeSecret(nodeId) }
}

/**
 * Wait for mesh to reach ready state.
 */
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

// ----------------------------------------------------------------------------
// Python Daemon Manager (generic)
// ----------------------------------------------------------------------------

const MESH_READY_TIMEOUT_MS = 30_000
const RESTART_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000]
const STARTUP_GRACE_PERIOD_MS = 5000

export type NodeAvailability =
  | { kind: 'available' }
  | { kind: 'unavailable'; reason: string }

export interface PythonNodeConfig {
  /** Node ID (e.g. 'reminders', 'calendar'). Used for logging, secrets, mesh registration. */
  id: string
  /** Absolute path to the node directory containing main.py. */
  nodeDir: string
  /** Python import statement to verify venv is bootstrapped (e.g. 'import EventKit'). */
  venvBootstrapCheck: string
  /** Platform constraint. If set, ensureRunning() short-circuits on other platforms. */
  platform?: 'darwin' | 'linux' | 'win32'
  /** Env var overrides. Merged into spawn env alongside NODE_ID, MESH_<ID>_SECRET, etc. */
  envOverrides?: Record<string, string>
}

export class PythonDaemonManager<TConfig extends PythonNodeConfig> extends EventEmitter {
  private config: TConfig
  private repoRoot: string
  private process: ChildProcess | null = null
  private logStream: fs.WriteStream | null = null
  private starting = false
  private availability: NodeAvailability = {
    kind: 'unavailable',
    reason: 'not started',
  }
  private restartAttempts = 0
  private restartTimer: NodeJS.Timeout | null = null
  private intentionallyStopped = false

  constructor(config: TConfig) {
    super()
    this.config = config

    // Resolve repo root from compiled main entry at shell/out/main/index.js
    this.repoRoot = path.resolve(__dirname, '..', '..', '..')

    // Verify directory exists
    if (!fs.existsSync(path.join(config.nodeDir, 'main.py'))) {
      console.error(
        `[${config.id}DaemonManager] nodeDir lookup failed: ${config.nodeDir} ` +
          `(expected to contain main.py). __dirname=${__dirname}`
      )
    }
  }

  getAvailability(): NodeAvailability {
    return this.availability
  }

  private setAvailability(a: NodeAvailability): void {
    this.availability = a
    this.emit('availability', a)
  }

  /**
   * Bootstrap Python venv if not present, install requirements.
   */
  private async bootstrap(): Promise<void> {
    const venvDir = path.join(this.config.nodeDir, 'venv')

    // Check if venv exists and is functional
    const venvPython = path.join(venvDir, 'bin', 'python3')
    if (fs.existsSync(venvPython)) {
      // Venv exists, verify requirements are installed
      try {
        const check = spawnSync(venvPython, ['-c', this.config.venvBootstrapCheck], {
          stdio: 'pipe',
          timeout: 5000,
        })
        if (check.status === 0) {
          console.log(`[${this.config.id}DaemonManager] venv already bootstrapped`)
          return
        }
      } catch {
        // Fall through to reinstall
      }
    }

    console.log(`[${this.config.id}DaemonManager] Bootstrapping venv...`)

    // Create venv
    const systemPython = this.resolvePython3()
    if (!systemPython) {
      throw new Error('python3 not found on PATH')
    }

    // Create venv
    console.log(`[${this.config.id}DaemonManager] Creating venv with ${systemPython}`)
    const createVenv = spawnSync(systemPython, ['-m', 'venv', venvDir], {
      cwd: this.config.nodeDir,
      stdio: 'inherit',
    })

    if (createVenv.status !== 0) {
      throw new Error(`Failed to create venv (exit ${createVenv.status})`)
    }

    // Install requirements
    const pipPath = path.join(venvDir, 'bin', 'pip')
    console.log(`[${this.config.id}DaemonManager] Installing requirements...`)
    const installReqs = spawnSync(pipPath, ['install', '-r', 'requirements.txt'], {
      cwd: this.config.nodeDir,
      stdio: 'inherit',
      timeout: 120_000, // pyobjc can be slow to compile
    })

    if (installReqs.status !== 0) {
      throw new Error(`Failed to install requirements (exit ${installReqs.status})`)
    }

    console.log(`[${this.config.id}DaemonManager] Bootstrap complete`)
  }

  /**
   * Resolve python3 from PATH. Lifted from shell/electron/main/services/python.ts.
   */
  private resolvePython3(): string | null {
    const shell = process.env.SHELL ?? '/bin/zsh'
    const result = spawnSync(shell, ['-lic', 'command -v python3'], {
      encoding: 'utf8',
      timeout: 2000,
    })
    if (result.status === 0 && result.stdout) {
      // Never trim()-trust a -lic capture: rc files print banners around the
      // path (#302 defect 6; see shellCapture.ts). Extract, then confirm.
      const py = pickBinaryLine(result.stdout)
      if (py && fs.existsSync(py)) return py
    }
    return null
  }

  /**
   * Ensure daemon is running. Spawns if not already running.
   * Returns when daemon is healthy or unrecoverably failed.
   */
  async ensureRunning(): Promise<void> {
    // Platform check (if config specifies a constraint)
    if (this.config.platform && process.platform !== this.config.platform) {
      this.setAvailability({
        kind: 'unavailable',
        reason: `${this.config.platform} required`,
      })
      return
    }

    if (this.process !== null && !this.process.killed) {
      console.log(`[${this.config.id}DaemonManager] Already running`)
      return
    }

    if (this.starting) {
      console.log(`[${this.config.id}DaemonManager] Start already in progress`)
      return
    }

    this.starting = true
    this.intentionallyStopped = false

    try {
      // Wait for mesh to be ready
      console.log(`[${this.config.id}DaemonManager] Waiting for mesh...`)
      const meshReady = await waitForMeshReady(MESH_READY_TIMEOUT_MS)
      if (!meshReady) {
        this.setAvailability({ kind: 'unavailable', reason: 'mesh not ready' })
        return
      }

      // Get mesh config
      const meshConfig = getNodeMeshConfig(this.config.id)
      if (!meshConfig) {
        console.error(`[${this.config.id}DaemonManager] Mesh config unavailable`)
        this.setAvailability({ kind: 'unavailable', reason: 'no mesh config' })
        return
      }

      // Bootstrap venv
      await this.bootstrap()

      // Spawn Python process
      const venvPython = path.join(this.config.nodeDir, 'venv', 'bin', 'python3')
      const coreDir = path.join(this.repoRoot, 'core')

      console.log(`[${this.config.id}DaemonManager] Spawning daemon...`)

      const secretEnvName = `MESH_${this.config.id.toUpperCase()}_SECRET`
      const baseEnv = {
        ...process.env,
        NODE_ID: this.config.id,
        [secretEnvName]: meshConfig.secret,
        MESH_CORE_URL: meshConfig.coreUrl,
        PYTHONPATH: coreDir,
        PYTHONUNBUFFERED: '1',
      }

      const env = this.config.envOverrides
        ? { ...baseEnv, ...this.config.envOverrides }
        : baseEnv

      this.process = spawn(venvPython, ['main.py'], {
        cwd: this.config.nodeDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      // Open per-node log file at mesh/<id>.log. Matches legacy
      // DaemonManager behavior — operational debugging for migrated
      // nodes (and Sprint 4's new nodes) relies on these files.
      // Stream persists across restarts; closed only on intentional stop().
      if (!this.logStream) {
        const logDir = path.join(app.getPath('userData'), 'mesh')
        fs.mkdirSync(logDir, { recursive: true })
        const logPath = path.join(logDir, `${this.config.id}.log`)
        this.logStream = fs.createWriteStream(logPath, { flags: 'a' })
      }
      this.logStream.write(`\n--- ${this.config.id} spawn @ ${new Date().toISOString()} ---\n`)

      // Log stdout/stderr (console + log file)
      this.process.stdout?.on('data', (data) => {
        const text = data.toString()
        this.logStream?.write(text)
        const lines = text.split('\n').filter(Boolean)
        lines.forEach((line: string) => {
          console.log(`[${this.config.id}] ${line}`)
        })
      })

      this.process.stderr?.on('data', (data) => {
        const text = data.toString()
        this.logStream?.write(text)
        const lines = text.split('\n').filter(Boolean)
        lines.forEach((line: string) => {
          console.error(`[${this.config.id}] ${line}`)
        })
      })

      // Handle exit
      this.process.on('exit', (code, signal) => {
        console.log(
          `[${this.config.id}DaemonManager] Process exited (code=${code}, signal=${signal})`
        )
        this.process = null
        this.setAvailability({ kind: 'unavailable', reason: 'process exited' })

        // Restart with backoff unless intentionally stopped
        if (!this.intentionallyStopped) {
          this.scheduleRestart()
        } else if (this.logStream) {
          // Intentional stop — flush and close log file
          this.logStream.end()
          this.logStream = null
        }
      })

      // Wait for startup grace period
      await new Promise((resolve) => setTimeout(resolve, STARTUP_GRACE_PERIOD_MS))

      if (this.process && !this.process.killed) {
        console.log(`[${this.config.id}DaemonManager] Daemon started`)
        this.setAvailability({ kind: 'available' })
        this.restartAttempts = 0
      } else {
        this.setAvailability({
          kind: 'unavailable',
          reason: 'crashed during startup',
        })
      }
    } catch (err) {
      console.error(`[${this.config.id}DaemonManager] Failed to start:`, err)
      this.setAvailability({
        kind: 'unavailable',
        reason: err instanceof Error ? err.message : 'unknown error',
      })
    } finally {
      this.starting = false
    }
  }

  /**
   * Schedule a restart with exponential backoff.
   */
  private scheduleRestart(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
    }

    const delay = RESTART_BACKOFF_MS[Math.min(this.restartAttempts, RESTART_BACKOFF_MS.length - 1)]
    this.restartAttempts++

    console.log(
      `[${this.config.id}DaemonManager] Scheduling restart in ${delay}ms (attempt ${this.restartAttempts})`
    )

    this.restartTimer = setTimeout(() => {
      this.ensureRunning().catch((err) => {
        console.error(`[${this.config.id}DaemonManager] Restart failed:`, err)
      })
    }, delay)
  }

  /**
   * Stop the daemon gracefully.
   */
  async stop(): Promise<void> {
    this.intentionallyStopped = true

    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }

    if (this.process && !this.process.killed) {
      console.log(`[${this.config.id}DaemonManager] Stopping daemon...`)
      this.process.kill('SIGTERM')

      // Wait up to 5s for graceful exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.process && !this.process.killed) {
            console.warn(`[${this.config.id}DaemonManager] SIGTERM timeout, sending SIGKILL`)
            this.process.kill('SIGKILL')
          }
          resolve()
        }, 5000)

        if (this.process) {
          this.process.once('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        } else {
          clearTimeout(timeout)
          resolve()
        }
      })

      this.process = null
    }

    this.setAvailability({ kind: 'unavailable', reason: 'stopped' })
    console.log(`[${this.config.id}DaemonManager] Stopped`)
  }

  /**
   * Register IPC handlers for renderer communication.
   */
  registerIpcHandlers(ipcMain: Electron.IpcMain): void {
    const prefix = this.config.id
    ipcMain.handle(`${prefix}:getAvailability`, () => {
      return this.getAvailability()
    })
  }
}

// ----------------------------------------------------------------------------
// Registration API
// ----------------------------------------------------------------------------

export interface RegisteredPythonNode {
  manager: PythonDaemonManager<PythonNodeConfig>
  ensureRunning: () => Promise<void>
  stop: () => Promise<void>
  getAvailability: () => NodeAvailability
  on: (event: 'availability', listener: (a: NodeAvailability) => void) => void
}

/**
 * Register a Python daemon-managed mesh node. Returns a handle to the node's
 * lifecycle manager.
 *
 * Example:
 *   const reminders = registerPythonDaemonNode({
 *     id: 'reminders',
 *     nodeDir: path.join(repoRoot, 'nodes', 'reminders'),
 *     venvBootstrapCheck: 'import EventKit; import Foundation',
 *     platform: 'darwin',
 *   })
 *
 *   // Later:
 *   await reminders.ensureRunning()
 *   reminders.on('availability', (a) => broadcast('reminders:availability-changed', a))
 */
export function registerPythonDaemonNode(
  config: PythonNodeConfig
): RegisteredPythonNode {
  // Generate secret for this node
  getNodeSecret(config.id)

  // Create manager instance
  const manager = new PythonDaemonManager(config)

  return {
    manager,
    ensureRunning: () => manager.ensureRunning(),
    stop: () => manager.stop(),
    getAvailability: () => manager.getAvailability(),
    on: (event, listener) => manager.on(event, listener),
  }
}
