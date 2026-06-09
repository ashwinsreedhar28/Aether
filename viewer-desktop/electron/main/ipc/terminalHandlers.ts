import { ipcMain, BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import fs from 'fs';

interface TerminalSession {
  id: string;
  pty: pty.IPty;
  shell: string;
  cwd: string;
}

const sessions = new Map<string, TerminalSession>();
let sessionCounter = 0;

// Get available shells on the system
function getAvailableShells(): string[] {
  const shells: string[] = [];
  const commonShells = ['/bin/zsh', '/bin/bash', '/bin/sh', '/usr/local/bin/fish'];

  for (const shell of commonShells) {
    if (fs.existsSync(shell)) {
      shells.push(shell);
    }
  }

  return shells;
}

// Get the default shell
function getDefaultShell(): string {
  return process.env.SHELL || '/bin/zsh';
}

export function registerTerminalHandlers(getMainWindow: () => BrowserWindow | null, getRootDir: () => string) {
  // Create a new terminal session
  ipcMain.handle('terminal:create', (_, cwd?: string, shell?: string) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      throw new Error('No main window available');
    }

    const sessionId = `terminal-${++sessionCounter}`;
    const shellPath = shell || getDefaultShell();
    const workingDir = cwd || getRootDir();

    // Spawn the PTY process
    const ptyProcess = pty.spawn(shellPath, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: workingDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      } as Record<string, string>,
    });

    // Store the session
    const session: TerminalSession = {
      id: sessionId,
      pty: ptyProcess,
      shell: shellPath,
      cwd: workingDir,
    };
    sessions.set(sessionId, session);

    // Forward PTY output to renderer
    ptyProcess.onData((data) => {
      const win = getMainWindow();
      if (!win || win.isDestroyed()) return;

      try {
        const webContents = win.webContents;
        if (webContents.isDestroyed()) return;

        // Check if mainFrame is available (guards against mid-disposal state)
        const mainFrame = webContents.mainFrame;
        if (!mainFrame) return;

        webContents.send('terminal:data', { sessionId, data });
      } catch {
        // Window/frame was destroyed during send - ignore silently
      }
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode }) => {
      const win = getMainWindow();
      if (!win || win.isDestroyed()) {
        sessions.delete(sessionId);
        return;
      }

      try {
        const webContents = win.webContents;
        if (webContents.isDestroyed()) {
          sessions.delete(sessionId);
          return;
        }

        // Check if mainFrame is available (guards against mid-disposal state)
        const mainFrame = webContents.mainFrame;
        if (!mainFrame) {
          sessions.delete(sessionId);
          return;
        }

        webContents.send('terminal:exit', { sessionId, exitCode });
      } catch {
        // Window/frame was destroyed during send - ignore silently
      }
      sessions.delete(sessionId);
    });

    return {
      sessionId,
      shell: shellPath,
      cwd: workingDir,
    };
  });

  // Write to terminal
  ipcMain.handle('terminal:write', (_, sessionId: string, data: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session ${sessionId} not found`);
    }
    session.pty.write(data);
    return { success: true };
  });

  // Resize terminal
  ipcMain.handle('terminal:resize', (_, sessionId: string, cols: number, rows: number) => {
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session ${sessionId} not found`);
    }
    session.pty.resize(cols, rows);
    return { success: true };
  });

  // Kill terminal session
  ipcMain.handle('terminal:kill', (_, sessionId: string) => {
    const session = sessions.get(sessionId);
    if (session) {
      session.pty.kill();
      sessions.delete(sessionId);
    }
    return { success: true };
  });

  // Get available shells
  ipcMain.handle('terminal:getShells', () => {
    return {
      shells: getAvailableShells(),
      defaultShell: getDefaultShell(),
    };
  });

  // Get session info
  ipcMain.handle('terminal:getSession', (_, sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
      return null;
    }
    return {
      id: session.id,
      shell: session.shell,
      cwd: session.cwd,
    };
  });
}

// Cleanup all terminal sessions (call on app quit)
export function cleanupTerminalSessions() {
  for (const [sessionId, session] of sessions) {
    try {
      session.pty.kill();
    } catch (e) {
      console.error(`Error killing terminal ${sessionId}:`, e);
    }
  }
  sessions.clear();
}
