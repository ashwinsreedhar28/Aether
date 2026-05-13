import { app, BrowserWindow, Tray, nativeImage, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { getRavenDaemonManager } from './services/ravenDaemonManager'

// Resolved relative to the compiled main entry at out/main/index.js.
// Resources sit at the project root under shell/resources/.
const RESOURCES_DIR = join(__dirname, '../../resources')
const PRELOAD_PATH = join(__dirname, '../preload/index.js')
const SPLASH_HTML = join(RESOURCES_DIR, 'splash.html')
const TRAY_ICON = join(RESOURCES_DIR, 'icons/trayTemplate.png')

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let tray: Tray | null = null

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
    console.warn('[homeOS] tray icon missing at', TRAY_ICON, '— run `pnpm gen:icons`')
  } else {
    icon.setTemplateImage(true)
  }
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('homeOS')
  tray.on('click', ensureMainVisible)
}

ipcMain.on('shell:renderer-ready', () => {
  resolveRendererReady?.()
})

ipcMain.handle('shell:metadata', () => {
  return {
    name: 'homeOS',
    version: app.getVersion(),
    isDev,
    bootedAt: new Date().toISOString(),
    // Renderer uses platform to inset the top nav past the macOS traffic
    // lights when titleBarStyle: 'hiddenInset' is in effect.
    platform: process.platform
  }
})

// Voice IPC — proxies to the raven daemon. The daemon-manager handles
// bootstrap, spawn supervision, WS subscription, and graceful shutdown.
// Renderer-facing surface is window.homeOS.voice (see preload/index.ts).
//
// Read-side handlers (status / recent-*) short-circuit to safe defaults
// when the daemon isn't reachable. The renderer's useEffect fires these
// on mount, well before the bootstrap finishes — without this guard we
// flood the main process with ECONNREFUSED for every render until the
// daemon is healthy.
const raven = getRavenDaemonManager()

ipcMain.handle('voice:availability', () => raven.getAvailability())
ipcMain.handle('voice:status', () => {
  if (raven.getAvailability().kind !== 'available') {
    return { status: 'stopped' as const }
  }
  return raven.status()
})
ipcMain.handle('voice:start', (e) => {
  console.log(`[homeOS] voice:start IPC from webContents.id=${e.sender.id} url=${e.sender.getURL()}`)
  return raven.listenStart()
})
ipcMain.handle('voice:stop', (e) => {
  console.log(`[homeOS] voice:stop IPC from webContents.id=${e.sender.id} url=${e.sender.getURL()}`)
  return raven.listenStop()
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

raven.on('availability', (a) => broadcastToRenderers('voice:availability-changed', a))
raven.on('status', (state) => broadcastToRenderers('voice:status-changed', state))
raven.on('transcript', (entry) => broadcastToRenderers('voice:transcript', entry))
raven.on('toolCall', (entry) => broadcastToRenderers('voice:tool-call', entry))

app.whenReady().then(async () => {
  splashWindow = createSplash()
  mainWindow = createMain()
  createTray()

  // Boot voice in parallel with the splash → reveal sequence. ensureRunning
  // resolves once the daemon is healthy OR the 10s timeout fires. We
  // deliberately don't await this in the reveal critical path: voice is
  // opt-in, and on first launch the venv install is ~30s which would freeze
  // the splash. The renderer paints with voice:offline and flips to
  // voice:ready when the availability event fires.
  void raven
    .ensureRunning()
    .then((avail) => {
      if (avail.kind !== 'available') {
        console.warn('[homeOS] voice unavailable:', avail.reason)
      } else {
        console.log('[homeOS] voice daemon healthy')
      }
    })
    .catch((err) => {
      console.error('[homeOS] ensureRunning threw:', err)
    })

  void revealMain()
})

// Clean shutdown — SIGTERM the daemon before quit so audio devices are
// released and no orphan Python child is left behind.
app.on('before-quit', async (event) => {
  if (raven.getAvailability().kind === 'available') {
    event.preventDefault()
    try {
      await raven.stop()
    } catch (err) {
      console.error('[homeOS] raven.stop() failed:', err)
    }
    app.exit(0)
  }
})

// Week-1 behaviour per CLAUDE.md §11: closing the only window quits the app
// on every platform. Once homeOS earns a "background mode" (substrate
// services running headless), this becomes platform-conditional.
app.on('window-all-closed', () => {
  app.quit()
})
