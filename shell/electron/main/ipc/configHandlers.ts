import { app, ipcMain } from 'electron';
import fs from 'fs/promises';
import path from 'path';

const CONFIG_DIR = path.join(app.getPath('userData'), 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function registerConfigHandlers() {
  // Load config
  ipcMain.handle('config:load', async () => {
    try {
      const content = await fs.readFile(CONFIG_FILE, 'utf-8');
      return JSON.parse(content);
    } catch {
      // Config doesn't exist yet
      return null;
    }
  });

  // Save config
  ipcMain.handle('config:save', async (_, config: unknown) => {
    try {
      await fs.mkdir(CONFIG_DIR, { recursive: true });
      await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      console.error('Failed to save config:', err);
      throw err;
    }
  });
}
