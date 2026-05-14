import { app, BrowserWindow, Tray, nativeImage, ipcMain, shell, dialog } from 'electron'
import { existsSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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

async function revealMain(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMain()
  }
  // Wait for React mount signal (capped at 2.5s) — the watchdog covers the
  // case where the renderer crashes or never sends the signal in dev mode.
  await Promise.race([
    rendererReady,
    new Promise<void>((resolve) => setTimeout(resolve, 2500))
  ])
  // Destroy splash synchronously (no fade) so the two windows never overlap.
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy()
  }
  splashWindow = null
  // Compositor settle. 180ms is generous — empirically enough on
  // M-series to ensure the splash destroy has been composited before
  // the main window's first paint lands. Without this, reveal jitters.
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

ipcMain.handle('voice:availability', () => raven.getAvailability())
ipcMain.handle('voice:status', () => {
  if (raven.getAvailability().kind !== 'available') {
    return { status: 'stopped' as const }
  }
  return raven.status()
})
ipcMain.handle('voice:start', () => raven.listenStart())
ipcMain.handle('voice:stop', () => raven.listenStop())
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

raven.on('availability', (a) => broadcastToRenderers('voice:availability-changed', a))
raven.on('status', (state) => broadcastToRenderers('voice:status-changed', state))
raven.on('transcript', (entry) => broadcastToRenderers('voice:transcript', entry))
raven.on('toolCall', (entry) => broadcastToRenderers('voice:tool-call', entry))

vision.on('availability', (a) => broadcastToRenderers('vision:availability-changed', a))

app.whenReady().then(() => {
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
