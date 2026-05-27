/**
 * Scene Server Daemon Manager (shell side)
 *
 * Lifecycle manager for the RAVEN_AVP scene server
 * (daemons/raven-avp-server/server/main.py). The scene server is an
 * external FastAPI daemon on port 5180 that holds visualization state
 * (SceneDoc panels + entities) and broadcasts mutations over WebSocket.
 *
 * It is NOT a mesh node — it's external HTTP infrastructure Aether
 * consumes, like a database. So this is the visionDaemonManager pattern
 * with the entire mesh layer removed:
 *  - No mesh registration / no MESH_*_SECRET injection
 *  - No waitForMeshReady — the scene server is independent of the mesh
 *  - No VisionAvailability discriminated union — just running/stopped
 *  - Health probe via HTTP GET /scene, not a Python import check
 *
 * Responsibilities:
 *  - Bootstrap the scene-server venv + install requirements on first run
 *  - Spawn `python3 main.py` with RAVEN_AVP_STATE_PATH pointed at
 *    <userData>/data/raven-avp/scene_state.json (keeps the submodule clean)
 *  - Probe GET /scene until healthy (10s budget)
 *  - Restart on crash with exponential backoff
 *  - SIGTERM cleanup on shell exit
 *
 * Per Sprint 6.2 Q1 we spawn ONLY main.py — never scene_driver.py. The
 * visualizer mesh node (Sprint 6.4) plays scene_driver's role in TS,
 * talking to the mesh instead of the scene server's /events stream.
 */

import { spawn, spawnSync, ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { resolvePython3 } from './python'
import {
  SCENE_SERVER_DIR,
  sceneServerDataDir,
  sceneServerStatePath,
} from './paths'

const SCENE_SERVER_URL = 'http://127.0.0.1:5180/scene'
const RESTART_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000]
const HEALTH_TIMEOUT_MS = 10_000
const HEALTH_POLL_INTERVAL_MS = 500
const PROBE_TIMEOUT_MS = 1000

/**
 * One-shot reachability check for the scene server. Exported so later
 * lanes (Sprint 6.3's scene subscriber) can ask "is the scene server up
 * right now?" before opening a WebSocket. Returns true on a 2xx /scene.
 */
export async function probeSceneServer(
  url: string = SCENE_SERVER_URL,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

export class SceneServerDaemonManager extends EventEmitter {
  private serverDir: string
  private serverProcess: ChildProcess | null = null
  private starting = false
  private running = false
  private restartAttempts = 0
  private restartTimer: NodeJS.Timeout | null = null
  private intentionallyStopped = false

  constructor() {
    super()
    this.serverDir = SCENE_SERVER_DIR

    if (!existsSync(join(this.serverDir, 'main.py'))) {
      console.error(
        `[scene-server] serverDir lookup failed: ${this.serverDir} ` +
          `(expected to contain main.py). The raven-avp-server submodule ` +
          `may not be checked out — run \`git submodule update --init\`.`,
      )
    }
  }

  isRunning(): boolean {
    return this.running
  }

  /**
   * Bootstrap the scene-server venv if not present, install requirements.
   * One-time (~30s on a clean checkout); subsequent boots reuse the venv.
   * Mirrors the submodule's start_server.sh, reimplemented in Node so the
   * shell owns the lifecycle (cleaner than shelling out to the script).
   */
  private bootstrap(): void {
    const venvDir = join(this.serverDir, '.venv')
    const venvPython = join(venvDir, 'bin', 'python3')

    // Venv exists and FastAPI imports cleanly → already bootstrapped.
    if (existsSync(venvPython)) {
      const check = spawnSync(venvPython, ['-c', 'import fastapi'], {
        stdio: 'pipe',
        timeout: 5000,
      })
      if (check.status === 0) {
        console.log('[scene-server] venv already bootstrapped')
        return
      }
    }

    console.log('[scene-server] Bootstrapping scene-server venv...')
    const systemPython = resolvePython3()

    console.log(`[scene-server] Creating venv with ${systemPython}`)
    const createVenv = spawnSync(systemPython, ['-m', 'venv', venvDir], {
      cwd: this.serverDir,
      stdio: 'inherit',
    })
    if (createVenv.status !== 0) {
      throw new Error(`Failed to create venv (exit ${createVenv.status})`)
    }

    const pipPath = join(venvDir, 'bin', 'pip')
    console.log('[scene-server] Installing requirements...')
    const installReqs = spawnSync(
      pipPath,
      ['install', '-q', '-r', join(this.serverDir, 'requirements.txt')],
      {
        cwd: this.serverDir,
        stdio: 'inherit',
        // mcp[cli] + the uvicorn/httpx stack can be slow to resolve on a
        // clean machine; give it generous headroom.
        timeout: 180_000,
      },
    )
    if (installReqs.status !== 0) {
      throw new Error(`Failed to install requirements (exit ${installReqs.status})`)
    }

    console.log('[scene-server] Bootstrap complete')
  }

  /**
   * Ensure the scene server is running. Spawns if not already running.
   * Resolves once the daemon is healthy OR a startup attempt fails (the
   * failure path schedules a backed-off restart). Per Sprint 6.2 Q3 the
   * shell does not block boot on this — callers fire it and walk away.
   */
  async ensureRunning(): Promise<void> {
    if (this.serverProcess !== null && !this.serverProcess.killed) {
      console.log('[scene-server] Already running')
      return
    }
    if (this.starting) {
      console.log('[scene-server] Start already in progress')
      return
    }

    this.starting = true
    this.intentionallyStopped = false

    try {
      // The scene server persists scene_state.json via os.replace, which
      // needs the parent dir to exist. Create it before spawn so the
      // first-run seed-and-persist doesn't crash on a missing directory.
      mkdirSync(sceneServerDataDir(), { recursive: true })

      this.bootstrap()

      const venvPython = join(this.serverDir, '.venv', 'bin', 'python3')
      console.log('[scene-server] Spawning scene server...')

      // Spread process.env so the server inherits OPENAI_API_KEY when the
      // shell has one (its /openai_key endpoint 503s without it, which is
      // fine — Aether doesn't consume that endpoint). MESH_*_SECRET vars
      // are NOT present in the shell's env (the mesh injects those per
      // child), so the spread can't leak them — the scene server is not a
      // mesh node and gets no mesh identity.
      this.serverProcess = spawn(venvPython, ['main.py'], {
        cwd: this.serverDir,
        env: {
          ...process.env,
          RAVEN_AVP_STATE_PATH: sceneServerStatePath(),
          PYTHONUNBUFFERED: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      this.serverProcess.stdout?.on('data', (data) => {
        data
          .toString()
          .split('\n')
          .filter(Boolean)
          .forEach((line: string) => console.log(`[scene-server] ${line}`))
      })
      this.serverProcess.stderr?.on('data', (data) => {
        data
          .toString()
          .split('\n')
          .filter(Boolean)
          .forEach((line: string) => console.error(`[scene-server] ${line}`))
      })

      this.serverProcess.on('exit', (code, signal) => {
        console.log(`[scene-server] Process exited (code=${code}, signal=${signal})`)
        this.serverProcess = null
        this.running = false
        if (!this.intentionallyStopped) {
          this.scheduleRestart()
        }
      })

      const healthy = await this.waitForHealth(HEALTH_TIMEOUT_MS)
      if (healthy) {
        this.running = true
        this.restartAttempts = 0
        console.log('[scene-server] healthy on http://127.0.0.1:5180')
        this.emit('available')
      } else {
        console.error('[scene-server] did not become healthy within 10s; restarting')
        // Kill the unresponsive process; its 'exit' handler schedules the
        // backed-off restart (so we don't double-schedule here).
        if (this.serverProcess && !this.serverProcess.killed) {
          this.serverProcess.kill('SIGTERM')
        }
      }
    } catch (err) {
      console.error('[scene-server] Failed to start:', err)
    } finally {
      this.starting = false
    }
  }

  /**
   * Poll GET /scene until healthy or the budget expires. Bails early if
   * the process has already exited (no point polling a dead server).
   */
  private async waitForHealth(timeoutMs: number): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await probeSceneServer()) return true
      if (this.serverProcess === null) return false
      await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS))
    }
    return false
  }

  private scheduleRestart(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
    }
    const delay =
      RESTART_BACKOFF_MS[Math.min(this.restartAttempts, RESTART_BACKOFF_MS.length - 1)]
    this.restartAttempts++
    console.log(
      `[scene-server] Scheduling restart in ${delay}ms (attempt ${this.restartAttempts})`,
    )
    this.restartTimer = setTimeout(() => {
      this.ensureRunning().catch((err) => {
        console.error('[scene-server] Restart failed:', err)
      })
    }, delay)
  }

  /**
   * Stop the scene server gracefully (SIGTERM, SIGKILL fallback after 5s).
   */
  async stop(): Promise<void> {
    this.intentionallyStopped = true

    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }

    if (this.serverProcess && !this.serverProcess.killed) {
      console.log('[scene-server] Stopping scene server...')
      this.serverProcess.kill('SIGTERM')

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.serverProcess && !this.serverProcess.killed) {
            console.warn('[scene-server] SIGTERM timeout, sending SIGKILL')
            this.serverProcess.kill('SIGKILL')
          }
          resolve()
        }, 5000)

        if (this.serverProcess) {
          this.serverProcess.once('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        } else {
          clearTimeout(timeout)
          resolve()
        }
      })

      this.serverProcess = null
    }

    this.running = false
    console.log('[scene-server] Stopped')
  }
}
