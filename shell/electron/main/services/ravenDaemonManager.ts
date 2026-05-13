/**
 * Raven Daemon Manager (shell side)
 *
 * Pattern lifted from _ingest/VIEWER/apps/viewer/electron/main/services/ravenDaemonManager.ts
 * (VIEWER SHA 9c58664), trimmed and adapted for homeOS:
 *
 *  - Daemon source lives at <repo>/daemons/raven-daemon (sibling to shell/).
 *  - Python child runs from <repo>/daemons/raven-core; the daemon itself
 *    supervises it. The shell only talks to the Node daemon over loopback
 *    HTTP+WS — never directly to Python.
 *  - First-run bootstrap: install daemon node_modules + build dist if
 *    missing, and create the raven-core venv + install requirements if
 *    missing. Both are one-time ~30s costs on a clean checkout.
 *  - GEMINI_API_KEY gate: if absent on ensureRunning(), do not spawn —
 *    log loudly, surface to renderer as an unavailable state. The shell
 *    stays usable; voice is opt-in.
 *  - macOS-only this PR; on other platforms ensureRunning() exits early
 *    with an "unavailable" status (CLAUDE.md §11 heuristic 7).
 */

import { spawn, spawnSync, ChildProcess } from 'node:child_process'
import { app } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as http from 'node:http'
import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'

const DEFAULT_PORT = 7433
const HEALTH_POLL_INTERVAL_MS = 250
const HEALTH_TIMEOUT_MS = 10_000
const REQUEST_TIMEOUT_MS = 5_000

// Voice availability status reported to the renderer. Distinct from
// RavenState — that's the Python child's lifecycle; this is whether the
// daemon is reachable at all.
export type VoiceAvailability =
  | { kind: 'available' }
  | { kind: 'unavailable'; reason: string }

// Pulled in by index.ts to attach IPC handlers.
export interface RavenManagerEvents {
  status: (state: unknown) => void
  transcript: (entry: unknown) => void
  toolCall: (entry: unknown) => void
  availability: (a: VoiceAvailability) => void
}

export class RavenDaemonManager extends EventEmitter {
  private port: number
  private dataDir: string
  private repoRoot: string
  private daemonDir: string
  private coreDir: string
  private daemonProcess: ChildProcess | null = null
  private ws: WebSocket | null = null
  private wsReconnectTimer: NodeJS.Timeout | null = null
  private starting = false
  private availability: VoiceAvailability = { kind: 'unavailable', reason: 'not started' }

  constructor(port: number = DEFAULT_PORT) {
    super()
    this.port = port
    // app.getPath('userData') is the Electron-managed per-app data dir.
    // raven-core writes memory.json under this.
    this.dataDir = path.join(app.getPath('userData'), 'raven')
    fs.mkdirSync(this.dataDir, { recursive: true })

    // Resolve repo root from the compiled main entry: out/main/index.js →
    // ../../.. lands at the shell/ directory; one more up gets the repo
    // root. In dev (electron-vite serves from out/), the same path applies.
    this.repoRoot = path.resolve(__dirname, '../../../..')
    this.daemonDir = path.join(this.repoRoot, 'daemons', 'raven-daemon')
    this.coreDir = path.join(this.repoRoot, 'daemons', 'raven-core')
  }

  getAvailability(): VoiceAvailability {
    return this.availability
  }

  baseUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  private setAvailability(a: VoiceAvailability): void {
    this.availability = a
    this.emit('availability', a)
  }

  /**
   * Probe /health on a short timeout. Used both before spawning (to detect
   * a daemon that's already running from a previous session) and after,
   * to wait until it's accepting requests.
   */
  private async isHealthy(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: this.port,
          path: '/health',
          method: 'GET',
          timeout: 1000,
        },
        (res) => {
          // drain the response so the socket can be reused / closed
          res.resume()
          resolve(res.statusCode === 200)
        }
      )
      req.on('error', () => resolve(false))
      req.on('timeout', () => {
        req.destroy()
        resolve(false)
      })
      req.end()
    })
  }

  private async waitForHealth(timeoutMs: number): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await this.isHealthy()) return true
      await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS))
    }
    return false
  }

  /**
   * Reap a stale PID file left by a daemon that died without cleaning up.
   * Without this, the next launch trips on "address in use" or thinks the
   * daemon is alive when it isn't.
   */
  private reapStalePid(): void {
    const pidFile = path.join(this.dataDir, 'daemon.pid')
    if (!fs.existsSync(pidFile)) return
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10)
      if (Number.isFinite(pid)) {
        // kill(pid, 0) throws if the process doesn't exist.
        try {
          process.kill(pid, 0)
          // Live — leave the PID file alone.
          return
        } catch {
          // Dead — clear the stale PID file.
        }
      }
      fs.unlinkSync(pidFile)
    } catch {
      // best-effort
    }
  }

  /**
   * One-time bootstrap. Returns false if any step fails (and reason is set
   * on availability).
   */
  private ensureBuilt(): boolean {
    const daemonDist = path.join(this.daemonDir, 'dist', 'index.js')
    const daemonModules = path.join(this.daemonDir, 'node_modules')

    if (!fs.existsSync(daemonModules)) {
      console.log('[ravenDaemonManager] installing daemon node_modules — first launch')
      const r = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: this.daemonDir,
        stdio: 'inherit',
      })
      if (r.status !== 0) {
        this.setAvailability({ kind: 'unavailable', reason: 'npm install failed in daemons/raven-daemon' })
        return false
      }
    }

    if (!fs.existsSync(daemonDist)) {
      console.log('[ravenDaemonManager] building raven-daemon (tsc) — first launch')
      const tsc = path.join(this.daemonDir, 'node_modules', '.bin', 'tsc')
      const r = spawnSync(tsc, [], { cwd: this.daemonDir, stdio: 'inherit' })
      if (r.status !== 0) {
        this.setAvailability({ kind: 'unavailable', reason: 'tsc build failed in daemons/raven-daemon' })
        return false
      }
    }

    const venvPython = path.join(this.coreDir, '.venv', 'bin', 'python')
    if (!fs.existsSync(venvPython)) {
      console.log('[ravenDaemonManager] creating raven-core venv — first launch (~30s)')
      const venv = spawnSync('python3', ['-m', 'venv', '.venv'], {
        cwd: this.coreDir,
        stdio: 'inherit',
      })
      if (venv.status !== 0) {
        this.setAvailability({ kind: 'unavailable', reason: 'python3 -m venv failed (is python3 installed?)' })
        return false
      }
      const pip = spawnSync(
        path.join(this.coreDir, '.venv', 'bin', 'pip'),
        ['install', '-q', '-r', 'requirements.txt'],
        { cwd: this.coreDir, stdio: 'inherit' }
      )
      if (pip.status !== 0) {
        this.setAvailability({ kind: 'unavailable', reason: 'pip install failed in daemons/raven-core' })
        return false
      }
    }

    return true
  }

  /**
   * Spawn the daemon process detached. The daemon writes its PID file and
   * supervises the Python child internally — we do not spawn Python here.
   */
  private spawnDaemon(): void {
    const daemonDist = path.join(this.daemonDir, 'dist', 'index.js')
    const venvPython = path.join(this.coreDir, '.venv', 'bin', 'python')

    this.daemonProcess = spawn('node', [daemonDist], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        RAVEN_DAEMON_PORT: String(this.port),
        RAVEN_DAEMON_DATA_DIR: this.dataDir,
        RAVEN_DIR: this.coreDir,
        RAVEN_PYTHON: venvPython,
        RAVEN_USER_DIR: this.dataDir,
      },
    })
    this.daemonProcess.unref()
    console.log(`[ravenDaemonManager] spawned daemon pid=${this.daemonProcess.pid}`)
  }

  /**
   * Ensure the daemon is running and the WS subscription is live. Safe to
   * call multiple times; concurrent calls collapse onto a single in-flight
   * startup.
   */
  async ensureRunning(): Promise<VoiceAvailability> {
    if (process.platform !== 'darwin') {
      this.setAvailability({ kind: 'unavailable', reason: 'voice: macOS only in this build' })
      return this.availability
    }

    if (!process.env.GEMINI_API_KEY) {
      // Task brief expected CEREBRAS_API_KEY, but raven-core actually uses
      // Gemini Live API for voice (see DECISIONS.md ADR). Surface what the
      // code actually wants.
      this.setAvailability({
        kind: 'unavailable',
        reason: 'voice: missing GEMINI_API_KEY env var',
      })
      return this.availability
    }

    if (this.starting) {
      while (this.starting) await new Promise((r) => setTimeout(r, 100))
      return this.availability
    }
    this.starting = true

    try {
      if (await this.isHealthy()) {
        this.setAvailability({ kind: 'available' })
        this.connectWs()
        return this.availability
      }

      this.reapStalePid()
      if (!this.ensureBuilt()) return this.availability

      this.spawnDaemon()
      const healthy = await this.waitForHealth(HEALTH_TIMEOUT_MS)
      if (!healthy) {
        this.setAvailability({
          kind: 'unavailable',
          reason: 'voice: daemon did not become healthy within 10s',
        })
        return this.availability
      }

      this.setAvailability({ kind: 'available' })
      this.connectWs()
      return this.availability
    } finally {
      this.starting = false
    }
  }

  /**
   * Open a persistent WS to the daemon. Auto-reconnects on close. The
   * caller (index.ts) wires events to webContents.send.
   */
  private connectWs(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer)
      this.wsReconnectTimer = null
    }
    try {
      this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`)
    } catch (e) {
      console.error('[ravenDaemonManager] ws ctor failed', e)
      return
    }

    this.ws.on('open', () => {
      this.ws?.send(JSON.stringify({ type: 'subscribe', channel: 'all' }))
    })

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as
          | { type: 'status'; state: unknown }
          | { type: 'transcript'; entry: unknown }
          | { type: 'tool-call'; entry: unknown }
          | { type: 'error'; message: string }
        if (msg.type === 'status') this.emit('status', msg.state)
        else if (msg.type === 'transcript') this.emit('transcript', msg.entry)
        else if (msg.type === 'tool-call') this.emit('toolCall', msg.entry)
      } catch {
        // ignore malformed frames
      }
    })

    this.ws.on('close', () => {
      this.ws = null
      // Only reconnect while we still consider voice available; if the
      // daemon went away, ensureRunning() is the right re-entry point.
      if (this.availability.kind === 'available' && !this.wsReconnectTimer) {
        this.wsReconnectTimer = setTimeout(() => {
          this.wsReconnectTimer = null
          this.connectWs()
        }, 1000)
      }
    })

    this.ws.on('error', (err) => {
      console.error('[ravenDaemonManager] ws error', err.message)
    })
  }

  /**
   * Make an HTTP request to the daemon. Returns the parsed body or throws.
   */
  private async request<T>(method: string, urlPath: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: this.port,
          path: urlPath,
          method,
          headers: { 'Content-Type': 'application/json' },
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          let data = ''
          res.on('data', (c) => (data += c))
          res.on('end', () => {
            try {
              const parsed = data ? JSON.parse(data) : {}
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error((parsed as { error?: string }).error || `HTTP ${res.statusCode}`))
              } else {
                resolve(parsed as T)
              }
            } catch {
              reject(new Error(`Invalid JSON: ${data}`))
            }
          })
        }
      )
      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('Request timeout'))
      })
      if (body !== undefined) req.write(JSON.stringify(body))
      req.end()
    })
  }

  /** POST /listen/start. */
  async listenStart(): Promise<unknown> {
    return this.request('POST', '/listen/start', {})
  }

  /** POST /listen/stop. */
  async listenStop(): Promise<unknown> {
    return this.request('POST', '/listen/stop')
  }

  /** GET /status. */
  async status(): Promise<unknown> {
    return this.request('GET', '/status')
  }

  /** GET /transcripts?limit=N. */
  async transcripts(limit: number = 20): Promise<unknown> {
    return this.request('GET', `/transcripts?limit=${limit}`)
  }

  /** GET /tool-calls?limit=N. */
  async toolCalls(limit: number = 20): Promise<unknown> {
    return this.request('GET', `/tool-calls?limit=${limit}`)
  }

  /**
   * Stop the daemon and its Python child. Called on app before-quit so we
   * don't leak processes. We sent SIGTERM to the daemon via the PID file
   * (more reliable than killing the detached spawned process from here).
   */
  async stop(): Promise<void> {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer)
      this.wsReconnectTimer = null
    }
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // ignore
      }
      this.ws = null
    }

    const pidFile = path.join(this.dataDir, 'daemon.pid')
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10)
        if (Number.isFinite(pid)) {
          try {
            process.kill(pid, 'SIGTERM')
          } catch {
            // already gone
          }
        }
      } catch {
        // ignore
      }
    }
    this.daemonProcess = null
  }
}

let instance: RavenDaemonManager | null = null
export function getRavenDaemonManager(): RavenDaemonManager {
  if (!instance) instance = new RavenDaemonManager()
  return instance
}
