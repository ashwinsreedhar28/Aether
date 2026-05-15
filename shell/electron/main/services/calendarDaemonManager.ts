/**
 * Calendar Daemon Manager (shell side)
 *
 * Lifecycle manager for the calendar node (nodes/calendar/).
 * Pattern lifted from visionDaemonManager.ts:
 *  - Python process only (no Node daemon layer)
 *  - Mesh-based communication (no dedicated HTTP/WS endpoints)
 *  - macOS-only (EventKit)
 *
 * Responsibilities:
 *  - Bootstrap calendar venv + install requirements on first run
 *  - Spawn Python process with CALENDAR_SECRET from mesh.toml
 *  - Wait for mesh registration
 *  - Restart on crash with exponential backoff
 *  - SIGTERM cleanup on shell exit
 */

import { spawn, ChildProcess } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { getCalendarMeshConfig, waitForMeshReady } from './mesh'
import { resolvePython3 } from './python'

const MESH_READY_TIMEOUT_MS = 30_000
const RESTART_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000]
const STARTUP_GRACE_PERIOD_MS = 5000

export type CalendarAvailability =
  | { kind: 'available' }
  | { kind: 'unavailable'; reason: string }

export interface CalendarManagerEvents {
  availability: (a: CalendarAvailability) => void
}

export class CalendarDaemonManager extends EventEmitter {
  private repoRoot: string
  private calendarDir: string
  private calendarProcess: ChildProcess | null = null
  private starting = false
  private availability: CalendarAvailability = {
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
    this.calendarDir = path.join(this.repoRoot, 'nodes', 'calendar')

    // Verify directory exists
    if (!fs.existsSync(path.join(this.calendarDir, 'main.py'))) {
      console.error(
        `[calendarDaemonManager] calendarDir lookup failed: ${this.calendarDir} ` +
          `(expected to contain main.py). __dirname=${__dirname}`
      )
    }
  }

  getAvailability(): CalendarAvailability {
    return this.availability
  }

  private setAvailability(a: CalendarAvailability): void {
    this.availability = a
    this.emit('availability', a)
  }

  /**
   * Bootstrap calendar venv if not present, install requirements.
   */
  private async bootstrap(): Promise<void> {
    const venvDir = path.join(this.calendarDir, 'venv')

    // Check if venv exists and is functional
    const venvPython = path.join(venvDir, 'bin', 'python3')
    if (fs.existsSync(venvPython)) {
      // Venv exists, verify requirements are installed
      try {
        const { spawnSync } = await import('node:child_process')
        const check = spawnSync(venvPython, ['-c', 'import EventKit; import Foundation'], {
          stdio: 'pipe',
          timeout: 5000,
        })
        if (check.status === 0) {
          console.log('[calendarDaemonManager] venv already bootstrapped')
          return
        }
      } catch {
        // Fall through to reinstall
      }
    }

    console.log('[calendarDaemonManager] Bootstrapping calendar venv...')

    // Create venv
    const systemPython = resolvePython3()
    if (!systemPython) {
      throw new Error('python3 not found on PATH')
    }

    const { spawnSync } = await import('node:child_process')

    // Create venv
    console.log(`[calendarDaemonManager] Creating venv with ${systemPython}`)
    const createVenv = spawnSync(systemPython, ['-m', 'venv', venvDir], {
      cwd: this.calendarDir,
      stdio: 'inherit',
    })

    if (createVenv.status !== 0) {
      throw new Error(`Failed to create venv (exit ${createVenv.status})`)
    }

    // Install requirements
    const pipPath = path.join(venvDir, 'bin', 'pip')
    console.log('[calendarDaemonManager] Installing requirements...')
    const installReqs = spawnSync(pipPath, ['install', '-r', 'requirements.txt'], {
      cwd: this.calendarDir,
      stdio: 'inherit',
      timeout: 120_000, // pyobjc can be slow to compile
    })

    if (installReqs.status !== 0) {
      throw new Error(`Failed to install requirements (exit ${installReqs.status})`)
    }

    console.log('[calendarDaemonManager] Bootstrap complete')
  }

  /**
   * Ensure calendar daemon is running. Spawns if not already running.
   * Returns when daemon is healthy or unrecoverably failed.
   */
  async ensureRunning(): Promise<void> {
    // Platform check: macOS only
    if (process.platform !== 'darwin') {
      this.setAvailability({
        kind: 'unavailable',
        reason: 'macOS required (EventKit)',
      })
      return
    }

    if (this.calendarProcess !== null && !this.calendarProcess.killed) {
      console.log('[calendarDaemonManager] Already running')
      return
    }

    if (this.starting) {
      console.log('[calendarDaemonManager] Start already in progress')
      return
    }

    this.starting = true
    this.intentionallyStopped = false

    try {
      // Wait for mesh to be ready
      console.log('[calendarDaemonManager] Waiting for mesh...')
      const meshReady = await waitForMeshReady(MESH_READY_TIMEOUT_MS)
      if (!meshReady) {
        this.setAvailability({ kind: 'unavailable', reason: 'mesh not ready' })
        return
      }

      // Get mesh config
      const meshConfig = getCalendarMeshConfig()
      if (!meshConfig) {
        console.error('[calendarDaemonManager] Calendar mesh config unavailable')
        this.setAvailability({ kind: 'unavailable', reason: 'no mesh config' })
        return
      }
      const calendarSecret = meshConfig.calendarSecret

      // Bootstrap venv
      await this.bootstrap()

      // Spawn Python process
      const venvPython = path.join(this.calendarDir, 'venv', 'bin', 'python3')
      const coreDir = path.join(this.repoRoot, 'core')

      console.log('[calendarDaemonManager] Spawning calendar daemon...')

      this.calendarProcess = spawn(venvPython, ['main.py'], {
        cwd: this.calendarDir,
        env: {
          ...process.env,
          NODE_ID: 'calendar',
          MESH_CALENDAR_SECRET: calendarSecret,
          MESH_CORE_URL: 'http://127.0.0.1:8000',
          PYTHONPATH: coreDir,
          PYTHONUNBUFFERED: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      // Log stdout/stderr
      this.calendarProcess.stdout?.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean)
        lines.forEach((line: string) => {
          console.log(`[calendar] ${line}`)
        })
      })

      this.calendarProcess.stderr?.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean)
        lines.forEach((line: string) => {
          console.error(`[calendar] ${line}`)
        })
      })

      // Handle exit
      this.calendarProcess.on('exit', (code, signal) => {
        console.log(`[calendarDaemonManager] Process exited (code=${code}, signal=${signal})`)
        this.calendarProcess = null
        this.setAvailability({ kind: 'unavailable', reason: 'process exited' })

        // Restart with backoff unless intentionally stopped
        if (!this.intentionallyStopped) {
          this.scheduleRestart()
        }
      })

      // Wait for startup grace period
      await new Promise((resolve) => setTimeout(resolve, STARTUP_GRACE_PERIOD_MS))

      if (this.calendarProcess && !this.calendarProcess.killed) {
        console.log('[calendarDaemonManager] Calendar daemon started')
        this.setAvailability({ kind: 'available' })
        this.restartAttempts = 0
      } else {
        this.setAvailability({
          kind: 'unavailable',
          reason: 'crashed during startup',
        })
      }
    } catch (err) {
      console.error('[calendarDaemonManager] Failed to start:', err)
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
      `[calendarDaemonManager] Scheduling restart in ${delay}ms (attempt ${this.restartAttempts})`
    )

    this.restartTimer = setTimeout(() => {
      this.ensureRunning().catch((err) => {
        console.error('[calendarDaemonManager] Restart failed:', err)
      })
    }, delay)
  }

  /**
   * Stop the calendar daemon gracefully.
   */
  async stop(): Promise<void> {
    this.intentionallyStopped = true

    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }

    if (this.calendarProcess && !this.calendarProcess.killed) {
      console.log('[calendarDaemonManager] Stopping calendar daemon...')
      this.calendarProcess.kill('SIGTERM')

      // Wait up to 5s for graceful exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.calendarProcess && !this.calendarProcess.killed) {
            console.warn('[calendarDaemonManager] SIGTERM timeout, sending SIGKILL')
            this.calendarProcess.kill('SIGKILL')
          }
          resolve()
        }, 5000)

        if (this.calendarProcess) {
          this.calendarProcess.once('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        } else {
          clearTimeout(timeout)
          resolve()
        }
      })

      this.calendarProcess = null
    }

    this.setAvailability({ kind: 'unavailable', reason: 'stopped' })
    console.log('[calendarDaemonManager] Stopped')
  }

  /**
   * Register IPC handlers for renderer communication.
   */
  registerIpcHandlers(ipcMain: Electron.IpcMain): void {
    ipcMain.handle('calendar:getAvailability', () => {
      return this.getAvailability()
    })
  }
}
