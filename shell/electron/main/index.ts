// Side-effect import: env-loader's module body calls loadEnvLocal() on
// evaluation, populating process.env from .env.local before any service
// module below captures or spreads it into a spawned child. Module
// evaluation order (depth-first, textual) guarantees this runs first.
// Must stay the FIRST import in this file.
import './env-loader'

import { app, BrowserWindow, Tray, nativeImage, ipcMain, shell, dialog, Notification } from 'electron'
import { existsSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  startMesh,
  stopMesh,
  meshInvoke,
  isCoreHealthy,
  getCoreUrl,
  getMeshState,
} from './services/mesh'
import { registerFileHandlers } from './handlers/files'
import { getRavenDaemonManager } from './services/ravenDaemonManager'
import { VisionDaemonManager } from './services/visionDaemonManager'
import { CalendarDaemonManager } from './services/calendarDaemonManager'
import { SceneServerDaemonManager } from './services/sceneServerDaemonManager'
import { SceneSubscriber } from './services/sceneSubscriber'
import { registerPythonDaemonNode, waitForMeshReady } from './services/nodeRegistry'

// Lock Electron's app name before any code calls app.getPath('userData') —
// app.getPath derives the userData root from the app name, and we want the
// migration step below to be the only thing that touches the old location.
app.setName('Aether')

// One-time rename of the working-name userData root. The renamed app's
// productName is "Aether", so app.getPath('userData') resolves to
// ~/Library/Application Support/Aether/ on macOS. Pre-rename, Electron put
// that same data under ~/Library/Application Support/homeOS/ — news / finance
// SQLite + raven memory live there. Idempotent: no-op if the new path already
// exists (fresh install or already-migrated) or the old path doesn't (fresh
// install). macOS-only — the working name never shipped on other platforms.
function migrateDataDirFromHomeOS(): void {
  if (process.platform !== 'darwin') return
  const supportRoot = join(homedir(), 'Library', 'Application Support')
  const oldPath = join(supportRoot, 'homeOS')
  const newPath = join(supportRoot, 'Aether')
  if (!existsSync(oldPath) || existsSync(newPath)) return
  try {
    renameSync(oldPath, newPath)
    console.log(`[aether-migrate] moved userData ${oldPath} -> ${newPath}`)
  } catch (err) {
    // Don't fail boot — the renamed app will start with an empty userData
    // root and the user can re-onboard. Better than a crash loop.
    console.warn('[aether-migrate] userData rename failed; continuing fresh:', err)
  }
}

migrateDataDirFromHomeOS()

// Resolved relative to the compiled main entry at out/main/index.js.
// Resources sit at the project root under shell/resources/.
const RESOURCES_DIR = join(__dirname, '../../resources')
const PRELOAD_PATH = join(__dirname, '../preload/index.js')
const SPLASH_PRELOAD_PATH = join(__dirname, '../preload/splashPreload.js')
const SPLASH_HTML = join(RESOURCES_DIR, 'splash.html')
const TRAY_ICON = join(RESOURCES_DIR, 'icons/trayTemplate.png')
const APP_ICON = join(__dirname, '../../assets/aether-icon.png')

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitInFlight = false
let cleanedUp = false

// Renderer-ready signal. The splash holds until the main renderer signals
// mount (or a 2.5s watchdog fires) — lifted from Pulse's main/index.ts
// reveal sequence, which is what prevents post-reveal compositor jitter.
let resolveRendererReady: (() => void) | null = null
const rendererReady = new Promise<void>((resolve) => {
  resolveRendererReady = resolve
})

function getMainURL(): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) return `${devUrl}/index.html`
  return `file://${join(__dirname, '../renderer/index.html')}`
}

function createSplash(): BrowserWindow {
  const win = new BrowserWindow({
    width: 440,
    height: 320,
    center: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: SPLASH_PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  void win.loadFile(SPLASH_HTML)
  win.on('closed', () => {
    splashWindow = null
  })
  return win
}

// Push a boot-phase update to the splash. No-op once the splash has been
// destroyed — revealMain races phases concurrently and we don't want a
// late sendSplashPhase from a still-pending promise to throw after dismiss.
function sendSplashPhase(label: string, index: number, total: number): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:phase', { label, index, total })
  }
}

function createMain(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 500,
    show: false,
    title: 'Aether',
    // PNG icon path is mostly load-bearing on Windows/Linux (window
    // chrome + taskbar). On macOS, packaged builds source the dock
    // icon from the bundled .icns via electron-builder's mac.icon,
    // and dev runs show Electron's default — harmless to pass.
    icon: APP_ICON,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0f',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // External http(s) links open in the user's browser, not in-app —
  // matches Pulse's no-tracker-noise stance.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  void win.loadURL(getMainURL())
  return win
}

// Floor — prevents flash-and-vanish on warm-cache startups where every
// subsystem is already healthy by the time the splash has rendered.
const MIN_SPLASH_MS = 1800
// Hard cap — never hold the splash longer than this even if a subsystem
// hangs. waitForMeshReady's own timeout argument enforces the mesh leg;
// raven.ensureRunning() resolves either way (ready or degraded). The cap
// is here as belt-and-braces so a misbehaving subsystem can't trap boot.
const HARD_CAP_MS = 15000

async function revealMain(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMain()
  }

  const startedAt = Date.now()
  const phases: { label: string; promise: Promise<unknown> }[] = []

  // Phase 1 — renderer-ready (kept; React still has to mount before show).
  phases.push({
    label: 'Renderer',
    promise: Promise.race([
      rendererReady,
      new Promise<void>((resolve) => setTimeout(resolve, 2500))
    ])
  })

  // Phase 2 — mesh ready. waitForMeshReady polls nodeRegistry's meshState
  // until 'ready' or 'failed', or the timeout fires. The timeout is the
  // hard cap, so the slowest the mesh leg can hold the splash is HARD_CAP_MS.
  phases.push({
    label: 'Mesh',
    promise: waitForMeshReady(HARD_CAP_MS).catch(() => false)
  })

  // Phase 3 — voice daemon. ensureRunning resolves either way (healthy or
  // 'unavailable'), so awaiting it means "voice has finished trying," not
  // "voice is up." That's the right gate — Voice pill flips red after this
  // resolves if it failed, but the rest of the shell stays usable.
  phases.push({
    label: 'Voice',
    promise: raven.ensureRunning().catch(() => undefined)
  })

  const total = phases.length

  // Announce each phase as it starts and again as it completes. Phases
  // run concurrently — Promise.all is just a join; phase order in the
  // status text reflects completion order, not array order.
  await Promise.all(
    phases.map(async (p, i) => {
      sendSplashPhase(p.label, i, total)
      await p.promise
      sendSplashPhase(`${p.label} ready`, i + 1, total)
    })
  )

  // Minimum-display floor. If everything was already warm and the phases
  // resolved fast, hold the splash long enough that the user actually
  // sees it instead of catching a flash of frame.
  const elapsed = Date.now() - startedAt
  if (elapsed < MIN_SPLASH_MS) {
    await new Promise<void>((resolve) => setTimeout(resolve, MIN_SPLASH_MS - elapsed))
  }

  // Destroy splash synchronously (no fade) so the two windows never overlap.
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy()
  }
  splashWindow = null
  // 180ms compositor settle — empirically enough on M-series to ensure
  // the splash destroy has been composited before the main window's
  // first paint lands. Without this, reveal jitters.
  await new Promise<void>((resolve) => setTimeout(resolve, 180))
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
}

function ensureMainVisible(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMain()
    void revealMain()
    return
  }
  if (mainWindow.isVisible()) {
    mainWindow.focus()
  } else {
    mainWindow.show()
    mainWindow.focus()
  }
}

function createTray(): void {
  const icon = nativeImage.createFromPath(TRAY_ICON)
  if (icon.isEmpty()) {
    // Loud warning — running without a tray icon is fine for dev but the
    // generated PNG is supposed to be committed in this PR.
    console.warn('[aether] tray icon missing at', TRAY_ICON, '— run `pnpm gen:icons`')
  } else {
    icon.setTemplateImage(true)
  }
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('Aether')
  tray.on('click', ensureMainVisible)
}

ipcMain.on('shell:renderer-ready', () => {
  resolveRendererReady?.()
})

ipcMain.handle('shell:metadata', () => {
  return {
    name: 'Aether',
    version: app.getVersion(),
    isDev,
    bootedAt: new Date().toISOString(),
    // Renderer uses platform to inset the top nav past the macOS traffic
    // lights when titleBarStyle: 'hiddenInset' is in effect.
    platform: process.platform
  }
})

// Open an external http(s) URL in the user's default browser. Anchored to
// http/https so a renderer can't trick the main process into shelling out
// to a file:// or other handler. The existing setWindowOpenHandler covers
// renderer-initiated window.open; this IPC is for explicit anchor clicks
// in sandboxed renderers where window.open is unreliable.
ipcMain.handle('shell:openExternal', async (_e, url: unknown) => {
  if (typeof url !== 'string') return { ok: false, reason: 'url_must_be_string' }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { ok: false, reason: 'unsupported_scheme' }
  }
  await shell.openExternal(url)
  return { ok: true }
})

// Mesh IPC. Renderer-facing surface is window.aether.mesh in preload.
// The renderer never holds a signing secret; main owns the shell's MeshNode.
ipcMain.handle('mesh:invoke', async (_e, target: string, payload: Record<string, unknown>) => {
  return meshInvoke(target, payload)
})

ipcMain.handle('mesh:status', async () => {
  const ms = getMeshState()
  return {
    coreUrl: getCoreUrl(),
    coreHealthy: await isCoreHealthy(),
    state: ms.state,
    error: ms.error,
  }
})

// Voice IPC — proxies to the raven daemon. The daemon-manager handles
// bootstrap, spawn supervision, WS subscription, and graceful shutdown.
// Renderer-facing surface is window.aether.voice in preload.
//
// Read-side handlers (status / recent-*) short-circuit to safe defaults
// when the daemon isn't reachable. The renderer's useEffect fires these
// on mount, well before the bootstrap finishes — without this guard we
// flood main with ECONNREFUSED for every render until the daemon is up.
const raven = getRavenDaemonManager()
const vision = new VisionDaemonManager()
const calendar = new CalendarDaemonManager()

// Scene server (RAVEN_AVP) — external FastAPI daemon on :5180, NOT a mesh
// node. Holds visualization state and broadcasts deltas over WS. The shell
// supervises its lifecycle but does not consume it yet (subscriber + UI
// land in Sprint 6.3). Boot does not block on it (Sprint 6.2 Q3).
const sceneServer = new SceneServerDaemonManager()

// Reminders node — migrated to registerNode factory pattern (proof-of-concept).
// Repo root is three levels up from compiled location at out/main/index.js.
const repoRoot = resolve(__dirname, '..', '..', '..')
const reminders = registerPythonDaemonNode({
  id: 'reminders',
  nodeDir: join(repoRoot, 'nodes', 'reminders'),
  venvBootstrapCheck: 'import EventKit; import Foundation',
  platform: 'darwin',
})

ipcMain.handle('voice:availability', () => raven.getAvailability())
ipcMain.handle('voice:status', () => {
  if (raven.getAvailability().kind !== 'available') {
    return { status: 'stopped' as const }
  }
  return raven.status()
})
ipcMain.handle('voice:start', () => raven.listenStart())
ipcMain.handle('voice:stop', () => raven.listenStop())
ipcMain.handle('voice:send-text', async (_e, text: unknown) => {
  // Default CLI input routes here — typed and spoken commands hit one brain.
  // Normalize the daemon's throw (e.g. 409 no_session) into a renderer-shaped
  // result so the CLI can paint a ✗ without try/catch in the component.
  const value = typeof text === 'string' ? text.trim() : ''
  if (!value) return { error: 'empty' }
  if (raven.getAvailability().kind !== 'available') return { error: 'no_session' }
  try {
    await raven.sendText(value)
    return { ok: true as const }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'send failed' }
  }
})
ipcMain.handle('voice:recent-transcripts', (_e, limit?: number) => {
  if (raven.getAvailability().kind !== 'available') {
    return { transcripts: [] }
  }
  return raven.transcripts(typeof limit === 'number' ? limit : 5)
})
ipcMain.handle('voice:recent-tool-calls', (_e, limit?: number) => {
  if (raven.getAvailability().kind !== 'available') {
    return { toolCalls: [] }
  }
  return raven.toolCalls(typeof limit === 'number' ? limit : 5)
})

function broadcastToRenderers(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(channel, payload)
  }
}

// Ambient voice (ambient-voice-v1). Hot mic while the shell is open: the
// moment raven becomes reachable we auto-start its listening session, so the
// Director never has to POST /listen/start by hand. Defaults ON (the
// Director's explicit hot-mic call on a single-user machine); the hard-off is
// `AETHER_VOICE_AMBIENT=0`, which skips auto-start entirely — the dashboard
// listening indicator then sits in its off state because nothing ever flips
// the daemon to 'running'.
const AMBIENT_VOICE = process.env.AETHER_VOICE_AMBIENT !== '0'
// Announce readiness once per shell session. A mid-session re-engage (daemon
// or child restart) re-runs listenStart but stays silent on the notification
// channel — the console log is the re-engage confirmation.
let ambientAnnounced = false
// Verbal ready cue (#129's deferred ask) is DISABLED pending redesign. The
// mechanism it relied on — text-injection + buffer-until-ready — shipped and
// is sound (it's the same path typed input uses, verified working). But
// injecting a greeting *instruction* as a user turn on setup_complete
// interleaves with the user's first real turn and scrambles the opening
// exchange. The fix is a different mechanism, not a different policy: have the
// orchestrator speak natively on setup_complete (a model-initiated greeting),
// rather than the shell flushing an instruction turn. Tracked as a known issue
// on the CLI-text PR. Re-enabling here is the wrong layer; leave it off.
// In-flight guard + cooldown so a child that dies on spawn (e.g. bad config)
// can't drive a tight listenStart loop via the status-event re-ensure below.
let ambientEngaging = false
let ambientLastStart = 0

// Idempotent "ensure listening." Called on every availability transition to
// 'available' (covers a full node-daemon restart: unavailable→available) AND
// on status pushes (covers a Python-child death: the node daemon stays up and
// only emits a status transition to 'stopped'/'error', so availability never
// moves — the child kill in the smoke test re-engages through this path, which
// is what "the daemon manager restarts it" actually is). Control plane only:
// listenStart is a POST the daemon no-ops if already running
// (ravenManager.ts:69), so re-firing on reconnect is safe.
async function ensureAmbientListening(state?: { status?: string }): Promise<void> {
  if (!AMBIENT_VOICE) return
  if (raven.getAvailability().kind !== 'available') return
  // On a status push, only re-engage when the session has actually dropped.
  // 'running'/'starting' mean listening is already (re)engaging; re-firing
  // would be noise. (state is undefined on an availability-driven call.)
  if (state && state.status !== 'stopped' && state.status !== 'error') return
  if (ambientEngaging) return
  const now = Date.now()
  if (now - ambientLastStart < 3000) return
  ambientEngaging = true
  ambientLastStart = now
  try {
    await raven.listenStart()
    console.log('[aether] ambient voice: listening')
    // Native shell-internal notification — NOT the mesh host_notifications
    // node. "Mic is hot" is shell state, not a mesh event, so it must not
    // take a mesh hop.
    if (!ambientAnnounced && Notification.isSupported()) {
      new Notification({ title: 'Aether', body: 'Listening, sir.' }).show()
      ambientAnnounced = true
    }
  } catch (err) {
    console.error('[aether] ambient voice: listenStart failed:', err)
  } finally {
    ambientEngaging = false
  }
}

raven.on('availability', (a) => {
  broadcastToRenderers('voice:availability-changed', a)
  if (a.kind === 'available') void ensureAmbientListening()
})
raven.on('status', (state) => {
  broadcastToRenderers('voice:status-changed', state)
  void ensureAmbientListening(state as { status?: string })
  // Verbal ready cue intentionally NOT fired here — disabled pending redesign
  // (see the greeting note above ensureAmbientListening).
})
raven.on('transcript', (entry) => broadcastToRenderers('voice:transcript', entry))
raven.on('toolCall', (entry) => broadcastToRenderers('voice:tool-call', entry))

vision.on('availability', (a) => broadcastToRenderers('vision:availability-changed', a))
calendar.on('availability', (a) => broadcastToRenderers('calendar:availability-changed', a))
reminders.on('availability', (a) => broadcastToRenderers('reminders:availability-changed', a))

// Scene subscriber — main owns the WS to the scene server; it forwards
// snapshots + deltas to the renderer over the 'scene:event' push channel.
// The renderer never opens a socket. start() is idempotent and does not block
// boot: if the scene server isn't up yet (Sprint 6.2 Q3), the subscriber
// retries with backoff until it's reachable, and reconnects if the daemon
// manager restarts it mid-session.
const sceneSubscriber = new SceneSubscriber()
sceneSubscriber.on('scene-event', (ev) => broadcastToRenderers('scene:event', ev))
sceneSubscriber.on('connection-changed', (connected: boolean) =>
  console.log('[aether] scene subscriber connection:', connected ? 'up' : 'down'),
)
sceneSubscriber.start()

// Scene panel POST — the renderer asks main to POST a panel to the scene
// server; main does the HTTP call so the renderer never touches :5180
// directly. NOTE: panel.style values MUST be strings — the scene server's AVP
// client decodes style as [String: String] (governance-log 2026-05-26). This
// proxy does not validate that; callers (the CLI in 6.3b) own the contract.
ipcMain.handle('scene:post-panel', async (_e, panel: Record<string, unknown>) => {
  try {
    const resp = await fetch('http://127.0.0.1:5180/scene/panel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(panel),
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) {
      return { ok: false, status: resp.status, error: await resp.text() }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

app.whenReady().then(() => {
  // macOS dev mode: set Dock icon explicitly. In packaged builds the .icns
  // from electron-builder handles this, but `pnpm dev` shows the generic
  // Electron icon without this call.
  if (process.platform === 'darwin') {
    app.dock?.setIcon(APP_ICON)
  }
  // Splash + main + tray created immediately so the reveal sequence stays
  // on PR #1's tested timing (splash → renderer-ready signal → destroy
  // splash → 180ms settle → show main). Both subsystem boots (mesh +
  // voice) are OFF this critical path; their respective status surfaces
  // (Mesh Dev Tools pill, Voice pill) flip when each becomes healthy.
  registerFileHandlers()
  splashWindow = createSplash()
  mainWindow = createMain()
  createTray()

  void revealMain()

  // Subsystem boot order: mesh first (load-bearing for mesh-dependent
  // apps — Mesh, eventually anything routed through manifest), then
  // voice (degrades gracefully — Voice pill goes red with a reason if
  // the daemon can't start; rest of the shell is unaffected).
  startMesh().catch((err) => {
    const message = (err as Error).message ?? String(err)
    dialog.showErrorBox(
      'Aether — mesh failed to start',
      `The mesh substrate could not start. Mesh-dependent features will be unavailable until you restart.\n\n${message}`,
    )
  })

  // Voice is opt-in. ensureRunning resolves once the daemon is healthy
  // OR the bootstrap times out. First launch is ~30s on a clean checkout
  // for the Python venv + pip install; bootstrap is async so the main
  // thread stays responsive (every other app remains usable while voice
  // initialises in the background).
  void raven
    .ensureRunning()
    .then((avail) => {
      if (avail.kind !== 'available') {
        console.warn('[aether] voice unavailable:', avail.reason)
      } else {
        console.log('[aether] voice daemon healthy')
      }
    })
    .catch((err) => {
      console.error('[aether] raven ensureRunning threw:', err)
    })

  // Vision capture daemon. Bootstrap pattern matches raven (async venv +
  // requirements). macOS-only (AVFoundation); on other platforms
  // ensureRunning() exits early with 'unavailable'.
  void vision
    .ensureRunning()
    .then(() => {
      const avail = vision.getAvailability()
      if (avail.kind !== 'available') {
        console.warn('[aether] vision unavailable:', avail.reason)
      } else {
        console.log('[aether] vision daemon healthy')
      }
    })
    .catch((err) => {
      console.error('[aether] vision ensureRunning threw:', err)
    })

  // Calendar daemon. Bootstrap pattern matches vision (async venv +
  // requirements). macOS-only (EventKit); on other platforms
  // ensureRunning() exits early with 'unavailable'.
  void calendar
    .ensureRunning()
    .then(() => {
      const avail = calendar.getAvailability()
      if (avail.kind !== 'available') {
        console.warn('[aether] calendar unavailable:', avail.reason)
      } else {
        console.log('[aether] calendar daemon healthy')
      }
    })
    .catch((err) => {
      console.error('[aether] calendar ensureRunning threw:', err)
    })

  // Reminders daemon. Same bootstrap pattern as calendar — async venv +
  // requirements (pyobjc + aiohttp). macOS-only (EventKit); on other
  // platforms ensureRunning() exits early with 'unavailable'.
  void reminders
    .ensureRunning()
    .then(() => {
      const avail = reminders.getAvailability()
      if (avail.kind !== 'available') {
        console.warn('[aether] reminders unavailable:', avail.reason)
      } else {
        console.log('[aether] reminders daemon healthy')
      }
    })
    .catch((err) => {
      console.error('[aether] reminders ensureRunning threw:', err)
      void 0
    })

  // Scene server (RAVEN_AVP) — external HTTP infrastructure, independent of
  // the mesh. ensureRunning bootstraps a venv on first run (~30s) then polls
  // GET /scene until healthy; on failure it schedules a backed-off restart.
  // Fired async so boot stays off this path (Sprint 6.2 Q3).
  void sceneServer
    .ensureRunning()
    .then(() => {
      if (sceneServer.isRunning()) {
        console.log('[aether] scene server healthy on :5180')
      } else {
        console.warn('[aether] scene server not yet healthy; will retry')
      }
    })
    .catch((err) => {
      console.error('[aether] scene server ensureRunning threw:', err)
    })
})

// Clean shutdown. before-quit fires on user-initiated quits AND on
// window-all-closed quits (since 'window-all-closed' calls app.quit()).
// Pattern matches the Architect's spec: preventDefault → await cleanup →
// flip cleanedUp → call app.quit() again. The second before-quit returns
// early without preventDefault, and Electron's quit sequence proceeds
// (will-quit → quit → exit) with the children already reaped.
//
// Both mesh and voice children get SIGTERM'd in parallel via
// Promise.allSettled. Sequential stop took up to 12s worst-case (long
// enough to risk Electron's quit timeout firing) — parallel keeps worst-
// case bounded by the slower of the two cleanups.
async function stopAllChildren(): Promise<void> {
  const results = await Promise.allSettled([
    stopMesh(),
    raven.stop(),
    vision.stop(),
    calendar.stop(),
    reminders.stop(),
    sceneServer.stop(),
    Promise.resolve(sceneSubscriber.stop()),
  ])
  for (const r of results) {
    if (r.status === 'rejected') {
      console.warn('[aether] child cleanup rejected:', r.reason)
    }
  }
}

app.on('before-quit', (event) => {
  if (cleanedUp) return
  event.preventDefault()
  if (quitInFlight) return
  quitInFlight = true
  void (async () => {
    await stopAllChildren()
    cleanedUp = true
    app.quit()
  })()
})

// Belt-and-braces for direct kill signals (Ctrl-C from a terminal that
// launched the shell, or a wrapper sending SIGTERM). before-quit doesn't
// fire on these; without an explicit handler, the children would orphan.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sig, () => {
    if (cleanedUp) return
    void (async () => {
      await stopAllChildren()
      cleanedUp = true
      app.exit(0)
    })()
  })
}


// Week-1 behaviour per CLAUDE.md §11: closing the only window quits the app
// on every platform. Once Aether earns a "background mode" (substrate
// services running headless), this becomes platform-conditional.
app.on('window-all-closed', () => {
  app.quit()
})
