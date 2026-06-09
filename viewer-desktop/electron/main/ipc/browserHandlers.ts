import { ipcMain, shell } from 'electron';

export function registerBrowserHandlers() {
  // Open URL in system's default browser
  ipcMain.handle('browser:openExternal', async (_, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error('Failed to open external URL:', error);
      return { success: false, error: String(error) };
    }
  });
}
