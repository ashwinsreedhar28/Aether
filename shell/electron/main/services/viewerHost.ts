// Viewer host glue. Encapsulates everything the absorbed Viewer renderer needs
// from the main process: workspace root-dir state, the file/terminal/config/
// browser IPC handlers, the file watcher lifecycle, the application menu, and
// the before-input-event keyboard shortcuts (⌘/ palette, ⌘+arrow window nav).
//
// Adapted from viewer-desktop/electron/main/index.ts (the parts that served the
// renderer). Aether's shell index.ts stays the host/boot orchestrator and calls
// initViewerHost() + attachViewerWindow() — the mesh/voice/spawn boot is
// unchanged and lives in index.ts.
import { BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { registerFileHandlers } from '../ipc/fileHandlers'
import { registerConfigHandlers } from '../ipc/configHandlers'
import { registerTerminalHandlers, cleanupTerminalSessions } from '../ipc/terminalHandlers'
import { registerBrowserHandlers } from '../ipc/browserHandlers'
import { FileWatcherService } from './fileWatcher'
import { createApplicationMenu } from './viewerMenu'

let rootDir: string | null = null
let fileWatcher: FileWatcherService | null = null
let getWin: () => BrowserWindow | null = () => null

// File/terminal handlers require an open workspace; throw (surfaced as an IPC
// error) rather than operating without a root directory.
function requireRootDir(): string {
  if (rootDir === null) throw new Error('No workspace is open')
  return rootDir
}

async function changeRootDir(newRootDir: string): Promise<void> {
  rootDir = newRootDir
  const win = getWin()
  if (fileWatcher && win && rootDir) {
    await fileWatcher.changeRoot(newRootDir, win)
  }
}

async function openFolderDialog(addToExisting = false): Promise<void> {
  const win = getWin()
  if (!win) return
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: addToExisting ? 'Add Folder to Workspace' : 'Open Folder',
  })
  if (!result.canceled && result.filePaths[0]) {
    await changeRootDir(result.filePaths[0])
    win.webContents.send('app:rootDirChanged', result.filePaths[0], addToExisting)
  }
}

function getInitialFolderFromArgs(): string | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('-')) continue
    const resolved = resolve(arg)
    if (existsSync(resolved)) return resolved
  }
  return null
}

// Register all renderer-facing IPC + the file watcher. Call once at boot.
export function initViewerHost(getMainWindow: () => BrowserWindow | null): void {
  getWin = getMainWindow

  const initialFolder = getInitialFolderFromArgs()
  if (initialFolder) rootDir = initialFolder

  fileWatcher = new FileWatcherService()

  ipcMain.handle('app:getRootDir', () => rootDir)
  ipcMain.handle('app:hasWorkspace', () => rootDir !== null)
  ipcMain.handle('app:setRootDir', async (_e, newRootDir: string) => {
    await changeRootDir(newRootDir)
    return rootDir
  })
  ipcMain.handle('dialog:openFolder', async (_e, addToExisting = false) => {
    const win = getWin()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: addToExisting ? 'Add Folder to Workspace' : 'Open Folder',
    })
    if (!result.canceled && result.filePaths[0]) {
      await changeRootDir(result.filePaths[0])
      return { path: result.filePaths[0], addToExisting }
    }
    return null
  })

  ipcMain.handle('fs:watchDir', async (_e, dirPath: string) => {
    if (fileWatcher) await fileWatcher.watchDirectory(dirPath)
    return { success: true }
  })
  ipcMain.handle('fs:unwatchDir', async (_e, dirPath: string) => {
    if (fileWatcher) await fileWatcher.unwatchDirectory(dirPath)
    return { success: true }
  })

  registerFileHandlers(requireRootDir)
  registerConfigHandlers()
  registerTerminalHandlers(getWin, requireRootDir)
  registerBrowserHandlers()

  // The renderer's control bridge announces itself on mount. The full agent→
  // renderer dispatch (viewer_desktop mesh node) lands in Phase 2; for now ack
  // so the renderer doesn't log an unhandled-invoke error.
  ipcMain.handle('control:bridge-ready', () => ({ ok: true }))
}

// Per-window setup: keyboard shortcuts, menu, file watcher start, initial folder.
export function attachViewerWindow(win: BrowserWindow): void {
  const isMac = process.platform === 'darwin'

  // Intercept ⌘/ (palette) and ⌘+arrow (window nav) BEFORE the renderer, so the
  // shortcuts work even when an editor (Monaco) has focus.
  win.webContents.on('before-input-event', (event, input) => {
    const modifierActive = isMac ? input.meta : input.control
    if (input.type === 'keyDown' && modifierActive && !input.alt && !input.shift) {
      if (input.key === '/') {
        event.preventDefault()
        win.webContents.send('menu:open-claude-palette')
        return
      }
      const arrowKeys: Record<string, string> = {
        ArrowUp: 'menu:focus-up',
        ArrowDown: 'menu:focus-down',
        ArrowLeft: 'menu:focus-left',
        ArrowRight: 'menu:focus-right',
      }
      const menuEvent = arrowKeys[input.key]
      if (menuEvent) {
        event.preventDefault()
        win.webContents.send(menuEvent)
      }
    }
  })

  const menu = createApplicationMenu(win, () => void openFolderDialog(false), () => void openFolderDialog(true))
  Menu.setApplicationMenu(menu)

  if (rootDir) void fileWatcher?.start(rootDir, win)

  const initialFolder = getInitialFolderFromArgs()
  if (initialFolder) {
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('app:initialFolder', initialFolder)
    })
  }
}

// The open workspace root (or null). The viewer_desktop node reads this to stage
// inline open_view sources under <root>/.viewer-tmp/ so the renderer's sandboxed
// fs:readFile (root-only) can read them.
export function getViewerRootDir(): string | null {
  return rootDir
}

export function stopViewerHost(): void {
  if (fileWatcher) void fileWatcher.stop()
  cleanupTerminalSessions()
}
