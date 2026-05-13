import { app, BrowserWindow, Tray, nativeImage, ipcMain, shell, dialog } from 'electron'
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
  const ms = getMeshState()
  return {
    coreUrl: getCoreUrl(),
    coreHealthy: await isCoreHealthy(),
    state: ms.state,
    error: ms.error,
  }
})

app.whenReady().then(() => {
  // Splash + main + tray created immediately so the reveal sequence stays
  // on PR #1's tested timing (splash → renderer-ready signal → destroy
  // splash → 180ms settle → show main). Mesh boot is OFF this critical
  // path; it spawns in parallel and the Mesh app's status pill flips
  // when Core is healthy. If mesh fails to start, the shell stays
  // useful for non-mesh apps (Welcome / News / Markdown) — mesh-
  // dependent features surface the failure via the pill + invoke
  // rejections + the dialog below.
  registerFileHandlers()
  splashWindow = createSplash()
  mainWindow = createMain()
  createTray()
  void revealMain()

  startMesh().catch((err) => {
    const message = (err as Error).message ?? String(err)
    dialog.showErrorBox(
      'homeOS — mesh failed to start',
      `The mesh substrate could not start. Mesh-dependent features will be unavailable until you restart.\n\n${message}`,
    )
  })
})

// Clean mesh shutdown. before-quit fires on user-initiated quits AND on
// window-all-closed quits (since 'window-all-closed' calls app.quit()).
// Pattern matches the Architect's spec: preventDefault → await cleanup →
// flip cleanedUp → call app.quit() again. The second before-quit returns
// early without preventDefault, and Electron's quit sequence proceeds
// (will-quit → quit → exit) with the children already reaped.
app.on('before-quit', (event) => {
  if (cleanedUp) return
  event.preventDefault()
  if (quitInFlight) return
  quitInFlight = true
  void (async () => {
    try {
      await stopMesh()
    } catch (e) {
      console.warn('[homeOS] stopMesh failed:', e)
    }
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
      try {
        await stopMesh()
      } catch {
        /* best-effort */
      }
      cleanedUp = true
      app.exit(0)
    })()
  })
}

// Week-1 behaviour per CLAUDE.md §11: closing the only window quits the app
// on every platform. Once homeOS earns a "background mode" (substrate
// services running headless), this becomes platform-conditional.
app.on('window-all-closed', () => {
  app.quit()
})
