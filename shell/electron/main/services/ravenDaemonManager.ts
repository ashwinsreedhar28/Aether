/**
 * Raven Daemon Manager (shell side)
 *
 * Pattern lifted from _ingest/VIEWER/apps/viewer/electron/main/services/ravenDaemonManager.ts
 * (VIEWER SHA 9c58664), trimmed and adapted for Aether:
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
import { pickBinaryLine } from './shellCapture'
import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { getRavenMeshConfig, waitForMeshReady } from './mesh'
import { nodeDataDir } from './paths'
import { isQuitting } from './appLifecycle'

// Prepend `<repo>/core` to the raven-core child's PYTHONPATH at spawn
// time so `from node_sdk import MeshNode` resolves to
// `<repo>/core/node_sdk/__init__.py`. The package directory is named
// `node_sdk`, so the parent directory must be on sys.path — putting
// `core/node_sdk` itself on PYTHONPATH would only expose the modules
// inside that directory as top-level imports, not the package as
// `node_sdk`. We use PYTHONPATH rather than `pip install -e` so the
// vendored tree stays untouched — core/README.md is explicit that
// core/{core,node_sdk,schemas} are managed by re-copying from the
// _ingest submodule, and a stray pyproject.toml would diverge.
//
// Wait for mesh before spawning Python: raven needs MESH_RAVEN_SECRET +
// MESH_CORE_URL to register with Core. Cap the wait at 30s; if mesh
// hasn't come up by then something is seriously wrong and we surface
// 'mesh not ready' on the voice pill rather than spawn into a crash
// loop.
const MESH_READY_TIMEOUT_MS = 30_000

const DEFAULT_PORT = 7433
const HEALTH_POLL_INTERVAL_MS = 250
const HEALTH_TIMEOUT_MS = 10_000
const REQUEST_TIMEOUT_MS = 5_000

/**
 * Recursive newest mtime across a directory. Used to decide whether a
 * built artefact (e.g. daemon's dist/index.js) is stale relative to its
 * source tree. macOS dir-mtime only updates on entry add/remove, so we
 * walk and stat each file.
 */
function newestMtime(dir: string): number {
  let newest = 0
  if (!fs.existsSync(dir)) return newest
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const m = entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs
    if (m > newest) newest = m
  }
  return newest
}

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

    // Compiled main entry lives at <repo>/shell/out/main/index.js, so three
    // '..' segments take us back to the repo root. In packaged mode this
    // will need a different resolution path (out lives inside app.asar);
    // out of scope for week-1 dev.
    this.repoRoot = path.resolve(__dirname, '..', '..', '..')
    this.daemonDir = path.join(this.repoRoot, 'daemons', 'raven-daemon')
    this.coreDir = path.join(this.repoRoot, 'daemons', 'raven-core')

    // Fail loudly if resolution drifts again — silent misresolution
    // surfaces downstream as misleading "pnpm not found on PATH" errors
    // (the actual ENOENT is on the missing cwd, not the binary).
    if (!fs.existsSync(path.join(this.daemonDir, 'package.json'))) {
      console.error(
        `[ravenDaemonManager] daemonDir lookup failed: ${this.daemonDir} ` +
          `(expected to contain package.json). __dirname=${__dirname}`
      )
    }
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
   * Reap the PID file left by a prior daemon. Reached only AFTER the
   * isHealthy() adopt check in ensureRunning() has already failed, so any
   * process still alive at this PID is either dead-and-stale or hung/orphaned —
   * never a healthy daemon we'd want to adopt.
   *
   * Two cases:
   *  - Dead PID: clear the stale file (the original job — otherwise the next
   *    launch trips on "address in use" or thinks the daemon is still up).
   *  - Alive but NOT ours: an orphan from a prior session — most often a daemon
   *    that spawned into a quitting shell (the pid=91597 incident) and survived
   *    the app, still holding the port. SIGTERM it and log, then clear the file,
   *    so this launch can bind a fresh daemon. ("Ours" = the child this manager
   *    spawned this session; at boot that is null, so a live PID here is by
   *    definition not ours.)
   */
  private reapStalePid(): void {
    const pidFile = path.join(this.dataDir, 'daemon.pid')
    if (!fs.existsSync(pidFile)) return
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10)
      if (Number.isFinite(pid)) {
        // kill(pid, 0) throws if the process doesn't exist.
        let alive = false
        try {
          process.kill(pid, 0)
          alive = true
        } catch {
          // Dead — fall through to clear the stale PID file.
        }
        if (alive) {
          if (this.daemonProcess?.pid === pid) return // our own live child — leave it
          // Identity check before signalling. kill(pid,0) only proves the pid is
          // LIVE, and pids recycle — an unrelated process could now hold it. Only
          // SIGTERM when the pid's command line actually matches our daemon;
          // otherwise it's a recycled pid and we just drop the stale file.
          if (this.isDaemonProcess(pid)) {
            console.warn(
              `[ravenDaemonManager] reaping orphan daemon pid=${pid} (alive but not ours; unhealthy at boot)`,
            )
            try {
              process.kill(pid, 'SIGTERM')
            } catch {
              // already gone between the check and here
            }
          } else {
            console.warn(
              `[ravenDaemonManager] pid=${pid} is alive but not our daemon (recycled) — clearing stale pid file only`,
            )
          }
        }
      }
      fs.unlinkSync(pidFile)
    } catch {
      // best-effort
    }
  }

  /**
   * Identity check for a pid before we signal it: is it actually OUR raven
   * daemon and not a recycled pid now held by something unrelated? We match the
   * process command line against the daemon dir (`<repo>/daemons/raven-daemon`,
   * which the `node <daemonDir>/dist/index.js` invocation carries) — far more
   * specific than the bare `node` comm name. ps unavailable / no match → treat
   * as NOT ours (fail safe: never SIGTERM on an uncertain identity).
   */
  private isDaemonProcess(pid: number): boolean {
    try {
      const out = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], {
        encoding: 'utf-8',
      })
      if (out.status !== 0 || !out.stdout) return false
      const cmd = out.stdout.trim()
      return cmd.includes(this.daemonDir) || /raven[-_]daemon/.test(cmd)
    } catch {
      return false
    }
  }

  /**
   * Cache of resolved binary paths (e.g. pnpm, python3). Resolved via
   * a login+interactive shell so user rc-file PATH additions
   * (Homebrew shellenv in ~/.zprofile, corepack shims in ~/.zshrc,
   * nvm in ~/.nvm/nvm.sh) are honoured. Without this, an Electron
   * main process spawned via `pnpm dev` on macOS frequently sees an
   * impoverished PATH that lacks the very `pnpm` that launched it.
   */
  private binCache = new Map<string, string>()

  private resolveBin(name: string): string {
    const cached = this.binCache.get(name)
    if (cached) return cached

    // Fast path: bare name works (PATH already contains it).
    const direct = spawnSync(name, ['--version'], { encoding: 'utf-8' })
    if (!direct.error && direct.status === 0) {
      this.binCache.set(name, name)
      return name
    }

    // Slow path: ask the user's default interactive login shell to
    // resolve it. zsh is the macOS default; honour $SHELL if set so a
    // bash user gets bash. -l sources zprofile, -i sources zshrc.
    const userShell = process.env.SHELL || '/bin/zsh'
    const probe = spawnSync(userShell, ['-lic', `command -v ${name}`], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (probe.status === 0 && probe.stdout) {
      // rc files print banners and noise AROUND the path — last-non-empty-line
      // loses to noise trailing the path, so extract the last absolute-path
      // line instead (#302 defect 6; see shellCapture.ts).
      const resolved = pickBinaryLine(probe.stdout)
      if (resolved && fs.existsSync(resolved)) {
        console.log(`[ravenDaemonManager] resolved ${name} → ${resolved} via ${userShell} -lic`)
        this.binCache.set(name, resolved)
        return resolved
      }
    }

    // Fall back to the bare name; the eventual spawn will ENOENT and
    // runStep will produce a clear error in the pill.
    return name
  }

  /**
   * Run a bootstrap step with captured output. ASYNC: returns a promise
   * that resolves when the spawned process exits. Mirrors stdio to the
   * main process console (so the user can see progress in the `pnpm dev`
   * terminal). On failure resolves with a `summary` string suitable for
   * the voice-control pill.
   *
   * Why async: pip install for pyaudio+opencv takes ~30s, and spawnSync
   * blocks Electron's main thread for the entire duration. That freezes
   * IPC, trips the network service watchdog, and lands a black-screen
   * renderer. Async spawn keeps the event loop responsive — the pill
   * updates, the splash → reveal sequence completes normally, and the
   * user can navigate other apps while voice bootstraps in the
   * background.
   */
  private runStep(
    label: string,
    cmd: string,
    args: string[],
    cwd: string
  ): Promise<{ ok: true; output: string } | { ok: false; summary: string; output: string }> {
    console.log(`[ravenDaemonManager] ${label}: cwd=${cwd} cmd=${cmd} ${args.join(' ')}`)
    // ENOENT-on-cwd is sneaky: spawn reports the same code as
    // ENOENT-on-bin and the surfaced error message blames the binary.
    // Pre-check cwd so the failure mode is unambiguous.
    if (!fs.existsSync(cwd)) {
      return Promise.resolve({
        ok: false,
        summary: `${label}: cwd does not exist: ${cwd}`,
        output: '',
      })
    }

    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd })
      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (chunk: Buffer) => {
        const s = chunk.toString()
        stdout += s
        process.stdout.write(s)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        const s = chunk.toString()
        stderr += s
        process.stderr.write(s)
      })

      child.on('error', (err) => {
        const code = (err as NodeJS.ErrnoException).code
        const detail = code === 'ENOENT' ? `${cmd} not found on PATH` : err.message
        resolve({ ok: false, summary: `${label}: ${detail}`, output: stderr + stdout })
      })

      child.on('exit', (code) => {
        const output = stderr + stdout
        if (code === 0) {
          resolve({ ok: true, output })
        } else {
          const tail = (stderr || stdout).trim().split('\n').filter(Boolean).slice(-1)[0] || `exit ${code}`
          resolve({ ok: false, summary: `${label}: ${tail.slice(0, 140)}`, output })
        }
      })
    })
  }

  /**
   * One-time bootstrap. Returns false if any step fails (and reason is set
   * on availability).
   *
   * Emits transient `unavailable` events before each blocking step so the
   * voice-control pill can show *what* the 30s first-boot is doing (per
   * PR #9 review). On success the caller flips availability to 'available'
   * once the daemon is healthy.
   *
   * Uses `pnpm` rather than `npm`: the repo's contract is pnpm (shell's
   * package.json pins it via corepack), and Electron's spawned env may
   * not include `npm` when Node is managed by nvm/asdf even though the
   * parent process has it. `pnpm dev` working is the proof that `pnpm`
   * is reachable.
   */
  private async ensureBuilt(): Promise<boolean> {
    const daemonDist = path.join(this.daemonDir, 'dist', 'index.js')
    const daemonModules = path.join(this.daemonDir, 'node_modules')

    if (!fs.existsSync(daemonModules)) {
      this.setAvailability({ kind: 'unavailable', reason: 'installing daemon deps…' })
      const r = await this.runStep(
        'installing daemon deps',
        this.resolveBin('pnpm'),
        ['install', '--prefer-offline'],
        this.daemonDir
      )
      if (!r.ok) {
        this.setAvailability({ kind: 'unavailable', reason: r.summary })
        return false
      }
    }

    // Rebuild the daemon when any source file in src/ is newer than the
    // built dist/index.js. Without this, daemon code changes that ship
    // in a pull-and-relaunch flow silently never take effect — dist is
    // already on disk and ensureBuilt would skip tsc.
    const daemonSrcDir = path.join(this.daemonDir, 'src')
    const distMtime = fs.existsSync(daemonDist) ? fs.statSync(daemonDist).mtimeMs : 0
    const srcMtime = newestMtime(daemonSrcDir)
    if (!fs.existsSync(daemonDist) || srcMtime > distMtime) {
      this.setAvailability({ kind: 'unavailable', reason: 'building daemon…' })
      const tsc = path.join(this.daemonDir, 'node_modules', '.bin', 'tsc')
      const r = await this.runStep('building daemon', tsc, [], this.daemonDir)
      if (!r.ok) {
        this.setAvailability({ kind: 'unavailable', reason: r.summary })
        return false
      }
    }

    // venv + pip step. Gate the pip install on a marker file rather than
    // venvPython existence — a prior failed install (e.g. pyaudio crashed
    // pre-portaudio) leaves a half-populated venv where Python exists but
    // the requirements are missing. Without the marker we'd skip pip and
    // hand the daemon a Python child that crashes on `import pyaudio`.
    //
    // Marker filename bumped to `-v2` when aiohttp was added to
    // requirements.txt (mesh client). Existing dev venvs from the prior
    // PR have an `.requirements-installed` marker but no aiohttp — by
    // changing the filename we force one more 30s pip run on first
    // launch after pulling this branch.
    const venvPython = path.join(this.coreDir, '.venv', 'bin', 'python')
    const reqsMarker = path.join(this.coreDir, '.venv', '.requirements-installed-v2')

    if (!fs.existsSync(venvPython)) {
      this.setAvailability({ kind: 'unavailable', reason: 'creating python venv…' })
      const venv = await this.runStep(
        'creating venv',
        this.resolveBin('python3'),
        ['-m', 'venv', '.venv'],
        this.coreDir
      )
      if (!venv.ok) {
        this.setAvailability({ kind: 'unavailable', reason: venv.summary })
        return false
      }
    }

    if (!fs.existsSync(reqsMarker)) {
      this.setAvailability({ kind: 'unavailable', reason: 'installing python deps (~30s)…' })
      const pip = await this.runStep(
        'installing python deps',
        path.join(this.coreDir, '.venv', 'bin', 'pip'),
        ['install', '-q', '-r', 'requirements.txt'],
        this.coreDir
      )
      if (!pip.ok) {
        // pyaudio is the most common stumble — its build needs portaudio
        // headers that don't ship with macOS. Detect the signature in
        // the captured output and rewrite the pill reason with an
        // actionable hint instead of the raw last-line gore.
        let reason = pip.summary
        if (
          pip.output.includes("'portaudio.h' file not found") ||
          /Failed building wheel for pyaudio/i.test(pip.output)
        ) {
          reason = 'pyaudio needs portaudio — run: brew install portaudio'
        }
        this.setAvailability({ kind: 'unavailable', reason })
        return false
      }
      // Pip succeeded — drop the marker so subsequent launches skip this
      // step. If requirements.txt changes meaningfully, delete this file
      // or the whole .venv to force a re-install.
      fs.writeFileSync(reqsMarker, new Date().toISOString())
    }

    return true
  }

  /**
   * Spawn the daemon process detached. The daemon writes its PID file and
   * supervises the Python child internally — we do not spawn Python here.
   *
   * `meshConfig` carries the per-launch identity raven needs to register
   * with Core (MESH_RAVEN_SECRET) plus Core's URL (MESH_CORE_URL).
   * PYTHONPATH gets `<repo>/core` (the parent of the SDK package
   * directory `node_sdk/`) prepended so raven-core can
   * `from node_sdk import MeshNode` without a pip install step
   * against the vendored tree.
   */
  private spawnDaemon(meshConfig: { ravenSecret: string; coreUrl: string }): void {
    // Defensive belt to the ensureRunning() guard: never launch into a
    // quitting app, even if a future caller reaches here by another path.
    if (isQuitting()) {
      console.warn('[ravenDaemonManager] spawnDaemon aborted — app is quitting')
      return
    }
    const daemonDist = path.join(this.daemonDir, 'dist', 'index.js')
    const venvPython = path.join(this.coreDir, '.venv', 'bin', 'python')

    // Prepend `<repo>/core` (the *parent* of the SDK package dir) so
    // `from node_sdk import MeshNode` resolves to
    // <repo>/core/node_sdk/__init__.py. The package name is the
    // directory name `node_sdk`, so PYTHONPATH must include its
    // parent — not the package directory itself.
    const sdkParent = path.join(this.repoRoot, 'core')
    const existingPythonPath = process.env.PYTHONPATH ?? ''
    const pythonPath = existingPythonPath
      ? `${sdkParent}${path.delimiter}${existingPythonPath}`
      : sdkParent

    this.daemonProcess = spawn('node', [daemonDist], {
      detached: true,
      // stdio: 'ignore' was hiding Python's crash output entirely — the
      // daemon's console.error('[Raven stderr]', line) handler routes to
      // its own stderr, which was /dev/null. Pipe both so the dev
      // terminal can see Python startup + tool calls + crashes prefixed
      // with [raven-daemon]. unref() still lets shell quit; piped fds
      // close cleanly on parent exit.
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        RAVEN_DAEMON_PORT: String(this.port),
        RAVEN_DAEMON_DATA_DIR: this.dataDir,
        RAVEN_DIR: this.coreDir,
        RAVEN_PYTHON: venvPython,
        RAVEN_USER_DIR: this.dataDir,
        // Shared Aether data root ($userData/data), identical to what the
        // node manager hands every mesh node. raven-core's draft_lane tool
        // writes Architect lane prompts under $AETHER_DATA_DIR/architect/drafts/
        // so they land in the shared data tree alongside per-node state rather
        // than in raven's private dir. The tool keeps a RAVEN_USER_DIR → ~/.raven
        // fallback for standalone runs where this isn't set.
        AETHER_DATA_DIR: nodeDataDir(),
        // Arms the request_spawn voice tool (constant-time check) and drives the
        // transcript store's passphrase redaction. Sourced from .env.local via
        // process.env; passed explicitly (like AETHER_DATA_DIR) so the intent is
        // visible at the spawn site rather than riding implicitly on ...process.env.
        // Empty when unset — request_spawn refuses, and redaction no-ops, on ''.
        AETHER_SPAWN_PHRASE: process.env.AETHER_SPAWN_PHRASE ?? '',
        // Lane concurrency cap (#268, spawn.max_lanes). Single-sourced from
        // .env.local so the work_on_issue capacity ask and the shell's
        // approve gate agree; '' lets the tool fall back to config.json then
        // its default of 3.
        AETHER_SPAWN_MAX_LANES: process.env.AETHER_SPAWN_MAX_LANES ?? '',
        // Mesh identity for raven-core. raven_core/mesh_client.py reads
        // these at orchestrator startup and registers with Core. Missing
        // either is a hard error in mesh_client (we always pass both
        // here; the daemon would still bring up time + memory tools
        // even without mesh, but that path is intended for manual
        // standalone runs of raven-core, not this Electron flow).
        MESH_CORE_URL: meshConfig.coreUrl,
        MESH_RAVEN_SECRET: meshConfig.ravenSecret,
        PYTHONPATH: pythonPath,
      },
    })
    this.daemonProcess.stdout?.on('data', (b: Buffer) => {
      process.stdout.write(`[raven-daemon] ${b}`)
    })
    this.daemonProcess.stderr?.on('data', (b: Buffer) => {
      process.stderr.write(`[raven-daemon] ${b}`)
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
      this.setAvailability({ kind: 'unavailable', reason: 'macOS only in this build' })
      return this.availability
    }

    if (!process.env.GEMINI_API_KEY) {
      // Task brief expected CEREBRAS_API_KEY, but raven-core actually uses
      // Gemini Live API for voice (see DECISIONS.md ADR). Surface what the
      // code actually wants.
      this.setAvailability({
        kind: 'unavailable',
        reason: 'missing GEMINI_API_KEY env var',
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
      if (!(await this.ensureBuilt())) return this.availability

      // Wait for mesh before spawn — raven needs MESH_RAVEN_SECRET and
      // MESH_CORE_URL to register with Core. The ensureBuilt() step
      // above can take ~30s on first run, so mesh has typically
      // finished booting in parallel by the time we reach this point.
      this.setAvailability({ kind: 'unavailable', reason: 'waiting for mesh…' })
      const meshReady = await waitForMeshReady(MESH_READY_TIMEOUT_MS)
      const meshConfig = meshReady ? getRavenMeshConfig() : null
      if (!meshConfig) {
        this.setAvailability({
          kind: 'unavailable',
          reason: meshReady ? 'mesh ready but identity unavailable' : 'mesh not ready',
        })
        return this.availability
      }

      // The shutdown race: ensureBuilt()/waitForMeshReady() above can burn
      // tens of seconds, and the Director may quit inside that window. If the
      // app is now tearing down, do NOT spawn — a daemon launched here parents
      // to a dying shell and orphans (the pid=91597 incident).
      if (isQuitting()) {
        this.setAvailability({ kind: 'unavailable', reason: 'app is quitting' })
        return this.availability
      }

      this.setAvailability({ kind: 'unavailable', reason: 'starting daemon…' })
      this.spawnDaemon(meshConfig)
      const healthy = await this.waitForHealth(HEALTH_TIMEOUT_MS)
      if (!healthy) {
        this.setAvailability({
          kind: 'unavailable',
          reason: 'daemon did not become healthy within 10s',
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

  /**
   * POST /listen/set-muted — soft-mute the live session's mic. The Python
   * child (and its Gemini conversation context) survives; only mic-frame
   * forwarding is gated inside the orchestrator. Rejects with
   * Error('no_session') (daemon 409) when no child is up to mute.
   */
  async setMuted(muted: boolean): Promise<unknown> {
    return this.request('POST', '/listen/set-muted', { muted })
  }

  /**
   * POST /text — route a typed user turn to raven (the same brain as voice).
   * Resolves with the daemon's {ok:true} ack on accept; rejects with
   * Error('no_session') when nothing is listening (daemon 409) so the caller
   * can render the cold-mic case. The model's reply arrives as spoken audio +
   * the existing transcript / tool-call pushes, not on this promise.
   */
  async sendText(text: string): Promise<unknown> {
    return this.request('POST', '/text', { text })
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
