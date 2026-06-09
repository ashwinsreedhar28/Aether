import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { existsSync, readFileSync } from 'fs';
import { registerFileHandlers } from './ipc/fileHandlers';
import { registerConfigHandlers } from './ipc/configHandlers';
import { registerTerminalHandlers, cleanupTerminalSessions } from './ipc/terminalHandlers';
import { registerBrowserHandlers } from './ipc/browserHandlers';
import { registerMcpHandlers, cleanupMcpHandlers } from './ipc/mcpHandlers';
import { registerLeapServiceHandlers, cleanupLeapServiceHandlers } from './ipc/leapServiceHandlers';
import { registerClaudeHandlers, cleanupClaudeHandlers } from './ipc/claudeHandlers';
import { registerWhisperHandlers, cleanupWhisperHandlers } from './ipc/whisperHandlers';
import { FileWatcherService } from './services/fileWatcher';
import { ControlServer } from './services/controlServer';
import { createViewerNode, type ViewerNode } from './services/viewerNode';
import { executeViewerControl } from './services/viewerControl';
import { registerAllGenerators } from '@viewer/core';
import { createApplicationMenu } from './menu';

let mainWindow: BrowserWindow | null = null;
let fileWatcher: FileWatcherService | null = null;
let controlServer: ControlServer | null = null;
let viewerNode: ViewerNode | null = null;

// Root directory - starts as null (no workspace), set when user opens a folder
let rootDir: string | null = null;

interface AetherViewerMeshConfig {
  coreUrl?: string;
  viewerMeshSecret?: string;
  writtenAt?: string;
}

function readAetherViewerMeshConfig(): AetherViewerMeshConfig | null {
  const configPath =
    process.env.AETHER_VIEWER_DESKTOP_MESH_CONFIG ||
    join(tmpdir(), 'aether-viewer-desktop-mesh.json');
  if (!existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as AetherViewerMeshConfig;
    if (typeof parsed !== 'object' || parsed == null) return null;
    return parsed;
  } catch (err) {
    console.warn('[viewerNode] Could not read Aether mesh config:', err);
    return null;
  }
}

// Parse CLI arguments for folder path
function getInitialFolderFromArgs(): string | null {
  // Skip first two args (electron executable and script path)
  const args = process.argv.slice(2);

  for (const arg of args) {
    // Skip flags
    if (arg.startsWith('-')) continue;

    // Check if it's a valid directory
    const resolvedPath = resolve(arg);
    if (existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  return null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false, // Required for preload to work in electron-vite
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // Enable webview tag for browser app
    },
  });

  // Intercept Cmd/Ctrl+Arrow keys BEFORE they reach the renderer (Monaco)
  // This ensures window navigation shortcuts work even when Monaco has focus
  // Monaco aggressively captures these keys for cursor navigation, but we want
  // them for window switching. The 'before-input-event' fires before the
  // renderer's DOM event handlers, bypassing Monaco entirely.
  const isMac = process.platform === 'darwin';
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Check for CmdOrCtrl (meta on Mac, control on Windows/Linux)
    const modifierActive = isMac ? input.meta : input.control;

    if (input.type === 'keyDown' && modifierActive && !input.alt && !input.shift) {
      // Handle Cmd+/ for Claude Command Palette
      if (input.key === '/') {
        event.preventDefault();
        mainWindow?.webContents.send('menu:open-claude-palette');
        return;
      }

      const arrowKeys: Record<string, string> = {
        'ArrowUp': 'menu:focus-up',
        'ArrowDown': 'menu:focus-down',
        'ArrowLeft': 'menu:focus-left',
        'ArrowRight': 'menu:focus-right',
      };

      const menuEvent = arrowKeys[input.key];
      if (menuEvent) {
        event.preventDefault();
        mainWindow?.webContents.send(menuEvent);
      }
    }
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (!rendererUrl) {
      throw new Error('ELECTRON_RENDERER_URL is required in development');
    }
    mainWindow.loadURL(rendererUrl);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Clean up terminal sessions and file watcher BEFORE the window closes
  // This prevents "Render frame was disposed" errors from async IPC sends
  mainWindow.on('close', () => {
    if (fileWatcher) {
      void fileWatcher.stop(); // Fire and forget - window is closing
    }
    cleanupTerminalSessions();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Set up file watcher (only if we have a root dir)
  fileWatcher = new FileWatcherService();
  if (rootDir) {
    void fileWatcher.start(rootDir, mainWindow);
  }

  // Create application menu
  const menu = createApplicationMenu(mainWindow, () => openFolderDialog(), () => openFolderDialog(true));
  Menu.setApplicationMenu(menu);

  // Register Claude handlers
  registerClaudeHandlers(mainWindow);
}

async function openFolderDialog(addToExisting = false) {
  if (!mainWindow) return;

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: addToExisting ? 'Add Folder to Workspace' : 'Open Folder',
  });

  if (!result.canceled && result.filePaths[0]) {
    const newRootDir = result.filePaths[0];
    await changeRootDir(newRootDir);
    // Send event with flag indicating if this is adding to existing workspaces
    mainWindow.webContents.send('app:rootDirChanged', newRootDir, addToExisting);
  }
}

async function changeRootDir(newRootDir: string) {
  rootDir = newRootDir;
  if (fileWatcher && mainWindow && rootDir) {
    await fileWatcher.changeRoot(newRootDir, mainWindow);
  }
}

// Register IPC handlers
function registerIpcHandlers() {
  // App-related handlers
  ipcMain.handle('app:getRootDir', () => rootDir);

  // Check if we have an active workspace
  ipcMain.handle('app:hasWorkspace', () => rootDir !== null);

  ipcMain.handle('app:setRootDir', async (_, newRootDir: string) => {
    await changeRootDir(newRootDir);
    return rootDir;
  });

  ipcMain.handle('dialog:openFolder', async (_, addToExisting = false) => {
    if (!mainWindow) return null;

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: addToExisting ? 'Add Folder to Workspace' : 'Open Folder',
    });

    if (!result.canceled && result.filePaths[0]) {
      await changeRootDir(result.filePaths[0]);
      return { path: result.filePaths[0], addToExisting };
    }
    return null;
  });

  // File/terminal handlers require an open workspace; throw (caught as an IPC
  // error) rather than operating without a root directory.
  const requireRootDir = (): string => {
    if (rootDir === null) throw new Error('No workspace is open');
    return rootDir;
  };

  // Register file operation handlers
  registerFileHandlers(requireRootDir);

  // Watch/unwatch directory handlers for lazy loading
  ipcMain.handle('fs:watchDir', async (_, dirPath: string) => {
    if (fileWatcher) {
      await fileWatcher.watchDirectory(dirPath);
    }
    return { success: true };
  });

  ipcMain.handle('fs:unwatchDir', async (_, dirPath: string) => {
    if (fileWatcher) {
      await fileWatcher.unwatchDirectory(dirPath);
    }
    return { success: true };
  });

  // Register config handlers
  registerConfigHandlers();

  // Register terminal handlers
  registerTerminalHandlers(() => mainWindow, requireRootDir);

  // Register browser handlers
  registerBrowserHandlers();

  // Register MCP handlers
  registerMcpHandlers(() => mainWindow);

  // Register Leap service handlers
  registerLeapServiceHandlers();

  // Register Whisper handlers
  registerWhisperHandlers(() => mainWindow);
}

// App lifecycle
app.whenReady().then(() => {
  // Check for CLI folder argument
  const initialFolder = getInitialFolderFromArgs();
  if (initialFolder) {
    rootDir = initialFolder;
  }

  registerIpcHandlers();
  createWindow();

  // Start the control server for CLI/agent control.
  // RETIREMENT NOTE: the viewer_desktop mesh node below is the intended successor
  // to this :7434 HTTP control server. The mesh path is now integration-proven
  // (role-play UX validation + 23 passing node tests dispatch through the same
  // executeViewerControl seam). It is NOT yet safe to delete :7434, however —
  // two live consumers still bind to it: claudeService.ts (in-app Claude) and
  // bin/viewer-ctl (CLI). Retire only after those two are migrated to the mesh
  // surface; the no-secret branch below only means "mesh disabled", not an
  // alternate mesh implementation.
  controlServer = new ControlServer({
    getMainWindow: () => mainWindow,
    getRootDir: () => rootDir,
  });
  controlServer.start().catch(err => console.error('[ControlServer] Failed to start:', err));

  // Start the mesh node alongside the control server. It exposes the shared
  // viewer surfaces and dispatches through the SAME control seam. Aether passes
  // the secret directly when it launches Viewer desktop and also writes a
  // short-lived handoff config so a normally launched Viewer can still attach
  // to the current Aether Core after restart.
  const aetherMesh = readAetherViewerMeshConfig();
  const meshSecret =
    process.env.VIEWER_MESH_SECRET ||
    process.env.MESH_VIEWER_DESKTOP_SECRET ||
    aetherMesh?.viewerMeshSecret;
  const meshCoreUrl = process.env.MESH_CORE_URL || aetherMesh?.coreUrl;
  if (meshSecret) {
    // Populate the shared @viewer/core generator registry so the node's
    // run_generator / list_generators surfaces resolve the slate slugs. Done
    // once at app startup (not in the node constructor, which would re-register
    // on every test-built node and clobber controlled-registry tests).
    registerAllGenerators();
    viewerNode = createViewerNode({
      dispatch: (action, params) => executeViewerControl(mainWindow, action, params),
      secret: meshSecret,
      coreUrl: meshCoreUrl,
      // Inline open_view sources are staged under <rootDir>/.viewer-tmp/ so the
      // renderer's sandboxed fs:readFile (root-only) can read them.
      getRootDir: () => rootDir,
    });
    viewerNode.start().catch(err => console.error('[viewerNode] Failed to start:', err));

    // SEND half of view_event: the renderer reports an interaction on a hosted
    // view (keyed by its windowId); resolve it to the opening agent and emit.
    // Fire-and-forget — a gesture must never surface an error back to the human.
    ipcMain.handle(
      'control:emit-view-event',
      (_e, windowId: string, action: string, data: Record<string, unknown>) => {
        viewerNode?.emitViewEventForWindow(windowId, action, data ?? {}).catch(() => {});
      }
    );
  } else {
    console.warn('[viewerNode] VIEWER_MESH_SECRET not set; mesh node disabled (control server :7434 still active)');
  }

  // If we have an initial folder from CLI, notify renderer after window is ready
  if (initialFolder && mainWindow) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow?.webContents.send('app:initialFolder', initialFolder);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (fileWatcher) {
    void fileWatcher.stop();
  }
  cleanupTerminalSessions();
  cleanupLeapServiceHandlers();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (fileWatcher) {
    void fileWatcher.stop();
  }
  if (controlServer) {
    controlServer.stop();
  }
  if (viewerNode) {
    void viewerNode.stop();
  }
  cleanupTerminalSessions();
  cleanupMcpHandlers();
  cleanupLeapServiceHandlers();
  cleanupClaudeHandlers();
  cleanupWhisperHandlers();
});
