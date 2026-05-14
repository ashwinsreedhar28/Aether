/**
 * Vision Daemon Manager (shell side)
 *
 * Lifecycle manager for the vision capture node (nodes/vision/).
 * Pattern lifted from ravenDaemonManager.ts and simplified:
 *  - Python process only (no Node daemon layer)
 *  - Mesh-based communication (no dedicated HTTP/WS endpoints)
 *  - macOS-only (AVFoundation)
 *
 * Responsibilities:
 *  - Bootstrap vision venv + install requirements on first run
 *  - Spawn Python process with VISION_SECRET from mesh.toml
 *  - Wait for mesh registration
 *  - Restart on crash with exponential backoff
 *  - SIGTERM cleanup on shell exit
 */

import { spawn, ChildProcess } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { getVisionMeshConfig, waitForMeshReady } from './mesh'
import { resolvePython3 } from './python'

const MESH_READY_TIMEOUT_MS = 30_000
const RESTART_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000]
const STARTUP_GRACE_PERIOD_MS = 5000

export type VisionAvailability =
  | { kind: 'available' }
  | { kind: 'unavailable'; reason: string }

export interface VisionManagerEvents {
  availability: (a: VisionAvailability) => void
}

export class VisionDaemonManager extends EventEmitter {
  private repoRoot: string
  private visionDir: string
  private visionProcess: ChildProcess | null = null
  private starting = false
  private availability: VisionAvailability = {
    kind: 'unavailable',
    reason: 'not started',
  }
  private restartAttempts = 0
  private restartTimer: NodeJS.Timeout | null = null
  private intentionallyStopped = false

  constructor() {
    super()

    // Resolve repo root from compiled main entry at shell/out/main/index.js
    this.repoRoot = path.resolve(__dirname, '..', '..', '..')
    this.visionDir = path.join(this.repoRoot, 'nodes', 'vision')

    // Verify directory exists
    if (!fs.existsSync(path.join(this.visionDir, 'main.py'))) {
      console.error(
        `[visionDaemonManager] visionDir lookup failed: ${this.visionDir} ` +
          `(expected to contain main.py). __dirname=${__dirname}`
      )
    }
  }

  getAvailability(): VisionAvailability {
    return this.availability
  }

  private setAvailability(a: VisionAvailability): void {
    this.availability = a
    this.emit('availability', a)
  }

  /**
   * Bootstrap vision venv if not present, install requirements.
   */
  private async bootstrap(): Promise<void> {
    const venvDir = path.join(this.visionDir, 'venv')

    // Check if venv exists and is functional
    const venvPython = path.join(venvDir, 'bin', 'python3')
    if (fs.existsSync(venvPython)) {
      // Venv exists, verify requirements are installed
      try {
        const { spawnSync } = await import('node:child_process')
        const check = spawnSync(venvPython, ['-c', 'import PIL; import AVFoundation'], {
          stdio: 'pipe',
          timeout: 5000,
        })
        if (check.status === 0) {
          console.log('[visionDaemonManager] venv already bootstrapped')
          return
        }
      } catch (_e) {
        // Fall through to reinstall
      }
    }

    console.log('[visionDaemonManager] Bootstrapping vision venv...')

    // Create venv
    const systemPython = resolvePython3()
    if (!systemPython) {
      throw new Error('python3 not found on PATH')
    }

    const { spawnSync } = await import('node:child_process')

    // Create venv
    console.log(`[visionDaemonManager] Creating venv with ${systemPython}`)
    const createVenv = spawnSync(systemPython, ['-m', 'venv', venvDir], {
      cwd: this.visionDir,
      stdio: 'inherit',
    })

    if (createVenv.status !== 0) {
      throw new Error(`Failed to create venv (exit ${createVenv.status})`)
    }

    // Install requirements
    const pipPath = path.join(venvDir, 'bin', 'pip')
    console.log('[visionDaemonManager] Installing requirements...')
    const installReqs = spawnSync(pipPath, ['install', '-r', 'requirements.txt'], {
      cwd: this.visionDir,
      stdio: 'inherit',
      timeout: 120_000, // pyobjc can be slow to compile
    })

    if (installReqs.status !== 0) {
      throw new Error(`Failed to install requirements (exit ${installReqs.status})`)
    }

    console.log('[visionDaemonManager] Bootstrap complete')
  }

  /**
   * Ensure vision daemon is running. Spawns if not already running.
   * Returns when daemon is healthy or unrecoverably failed.
   */
  async ensureRunning(): Promise<void> {
    // Platform check: macOS only
    if (process.platform !== 'darwin') {
      this.setAvailability({
        kind: 'unavailable',
        reason: 'macOS required (AVFoundation)',
      })
      return
    }

    if (this.visionProcess !== null && !this.visionProcess.killed) {
      console.log('[visionDaemonManager] Already running')
      return
    }

    if (this.starting) {
      console.log('[visionDaemonManager] Start already in progress')
      return
    }

    this.starting = true
    this.intentionallyStopped = false

    try {
      // Wait for mesh to be ready
      console.log('[visionDaemonManager] Waiting for mesh...')
      const meshReady = await waitForMeshReady(MESH_READY_TIMEOUT_MS)
      if (!meshReady) {
        this.setAvailability({ kind: 'unavailable', reason: 'mesh not ready' })
        return
      }

      // Get mesh config
      const meshConfig = getVisionMeshConfig()
      if (!meshConfig) {
        console.error('[visionDaemonManager] Vision mesh config unavailable')
        this.setAvailability({ kind: 'unavailable', reason: 'no mesh config' })
        return
      }
      const visionSecret = meshConfig.visionSecret

      // Bootstrap venv
      await this.bootstrap()

      // Spawn Python process
      const venvPython = path.join(this.visionDir, 'venv', 'bin', 'python3')
      const coreDir = path.join(this.repoRoot, 'core')

      console.log('[visionDaemonManager] Spawning vision daemon...')

      this.visionProcess = spawn(venvPython, ['main.py'], {
        cwd: this.visionDir,
        env: {
          ...process.env,
          NODE_ID: 'vision',
          VISION_SECRET: visionSecret,
          CORE_URL: 'http://127.0.0.1:8000',
          PYTHONPATH: coreDir,
          PYTHONUNBUFFERED: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      // Log stdout/stderr
      this.visionProcess.stdout?.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean)
        lines.forEach((line: string) => {
          console.log(`[vision] ${line}`)
        })
      })

      this.visionProcess.stderr?.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean)
        lines.forEach((line: string) => {
          console.error(`[vision] ${line}`)
        })
      })

      // Handle exit
      this.visionProcess.on('exit', (code, signal) => {
        console.log(`[visionDaemonManager] Process exited (code=${code}, signal=${signal})`)
        this.visionProcess = null
        this.setAvailability({ kind: 'unavailable', reason: 'process exited' })

        // Restart with backoff unless intentionally stopped
        if (!this.intentionallyStopped) {
          this.scheduleRestart()
        }
      })

      // Wait for startup grace period
      await new Promise((resolve) => setTimeout(resolve, STARTUP_GRACE_PERIOD_MS))

      if (this.visionProcess && !this.visionProcess.killed) {
        console.log('[visionDaemonManager] Vision daemon started')
        this.setAvailability({ kind: 'available' })
        this.restartAttempts = 0
      } else {
        this.setAvailability({
          kind: 'unavailable',
          reason: 'crashed during startup',
        })
      }
    } catch (err) {
      console.error('[visionDaemonManager] Failed to start:', err)
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

    const delay =
      RESTART_BACKOFF_MS[Math.min(this.restartAttempts, RESTART_BACKOFF_MS.length - 1)]
    this.restartAttempts++

    console.log(
      `[visionDaemonManager] Scheduling restart in ${delay}ms (attempt ${this.restartAttempts})`
    )

    this.restartTimer = setTimeout(() => {
      this.ensureRunning().catch((err) => {
        console.error('[visionDaemonManager] Restart failed:', err)
      })
    }, delay)
  }

  /**
   * Stop the vision daemon gracefully.
   */
  async stop(): Promise<void> {
    this.intentionallyStopped = true

    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }

    if (this.visionProcess && !this.visionProcess.killed) {
      console.log('[visionDaemonManager] Stopping vision daemon...')
      this.visionProcess.kill('SIGTERM')

      // Wait up to 5s for graceful exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.visionProcess && !this.visionProcess.killed) {
            console.warn('[visionDaemonManager] SIGTERM timeout, sending SIGKILL')
            this.visionProcess.kill('SIGKILL')
          }
          resolve()
        }, 5000)

        if (this.visionProcess) {
          this.visionProcess.once('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        } else {
          clearTimeout(timeout)
          resolve()
        }
      })

      this.visionProcess = null
    }

    this.setAvailability({ kind: 'unavailable', reason: 'stopped' })
    console.log('[visionDaemonManager] Stopped')
  }

  /**
   * Register IPC handlers for renderer communication.
   */
  registerIpcHandlers(ipcMain: Electron.IpcMain): void {
    ipcMain.handle('vision:getAvailability', () => {
      return this.getAvailability()
    })
  }
}
