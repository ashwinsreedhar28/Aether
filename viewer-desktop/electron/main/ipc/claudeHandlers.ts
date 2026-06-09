/**
 * Claude IPC Handlers
 * Registers handlers for Claude command palette interactions
 */

import { ipcMain, BrowserWindow } from 'electron';
import { claudeService } from '../services/claudeService';

export function registerClaudeHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(
    'claude:query',
    async (
      _,
      prompt: string,
      context: {
        cwd: string;
        currentFile?: string;
        model?: string;
        resume?: string;
        openFiles?: string[];
      }
    ) => {
      return new Promise((resolve, reject) => {
        claudeService.query({
          prompt,
          cwd: context.cwd,
          currentFile: context.currentFile,
          model: context.model,
          resume: context.resume,
          openFiles: context.openFiles,
          onMessage: (msg) => {
            mainWindow.webContents.send('claude:stream', msg);
          },
          onComplete: () => {
            resolve({ success: true });
          },
          onError: (error) => {
            reject(error);
          },
        });
      });
    }
  );

  ipcMain.handle('claude:abort', async () => {
    claudeService.abort();
    return { success: true };
  });

  ipcMain.handle('claude:auth-status', async () => {
    return claudeService.getAuthStatus();
  });
}

export function cleanupClaudeHandlers(): void {
  claudeService.abort();
}
