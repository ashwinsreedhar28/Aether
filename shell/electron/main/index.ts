import { app, BrowserWindow, Tray, nativeImage, ipcMain, shell, dialog } from 'electron'
import { join } from 'node:path'
import {
  startMesh,
  stopMesh,
  meshInvoke,
  isCoreHealthy,
  getCoreUrl,
} from './services/mesh'

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
let quitInFlight = false

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

ipcMain.handle('mesh:invoke', async (_e, target: string, payload: Record<string, unknown>) => {
  return meshInvoke(target, payload)
})

ipcMain.handle('mesh:status', async () => {
  return {
    coreUrl: getCoreUrl(),
    coreHealthy: await isCoreHealthy(),
  }
})

app.whenReady().then(async () => {
  // Per task spec: start the mesh BEFORE creating the splash. If Core fails
  // to come up in 30s, there's nothing else for the shell to do, so we
  // surface a clear error and quit instead of dropping into a broken UI.
  try {
    await startMesh()
  } catch (err) {
    const message = (err as Error).message ?? String(err)
    dialog.showErrorBox('homeOS — mesh failed to start', message)
    app.exit(1)
    return
  }
  splashWindow = createSplash()
  mainWindow = createMain()
  createTray()
  void revealMain()
})

// Clean mesh shutdown. before-quit fires on user-initiated quits AND on
// window-all-closed quits (since 'window-all-closed' calls app.quit()).
// We preventDefault the first round, run async cleanup, then exit.
app.on('before-quit', (e) => {
  if (quitInFlight) return
  quitInFlight = true
  e.preventDefault()
  void (async () => {
    try {
      await stopMesh()
    } catch {
      /* best-effort on quit */
    }
    app.exit(0)
  })()
})

// Week-1 behaviour per CLAUDE.md §11: closing the only window quits the app
// on every platform. Once homeOS earns a "background mode" (substrate
// services running headless), this becomes platform-conditional.
app.on('window-all-closed', () => {
  app.quit()
})
