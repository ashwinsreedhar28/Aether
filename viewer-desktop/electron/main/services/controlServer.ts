/**
 * Control Server
 * HTTP server embedded in the Electron main process that accepts commands
 * from the viewer-ctl CLI and dispatches them to the renderer's control bridge.
 */

import http from 'http';
import { BrowserWindow, ipcMain } from 'electron';
import { executeViewerControl } from './viewerControl';

interface ControlServerOptions {
  port?: number;
  getMainWindow: () => BrowserWindow | null;
  getRootDir: () => string | null;
}

export class ControlServer {
  private server: http.Server | null = null;
  private port: number;
  private getMainWindow: () => BrowserWindow | null;
  private bridgeReady = false;

  constructor(options: ControlServerOptions) {
    this.port = options.port || parseInt(process.env.VIEWER_CONTROL_PORT || '7434', 10);
    this.getMainWindow = options.getMainWindow;

    // Listen for bridge ready signal from renderer
    ipcMain.handle('control:bridge-ready', () => {
      this.bridgeReady = true;
      return { success: true };
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`[ControlServer] Port ${this.port} is already in use`);
        } else {
          console.error('[ControlServer] Server error:', err);
        }
        reject(err);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`[ControlServer] Listening on http://127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS headers for localhost
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);
    const path = url.pathname;

    try {
      // Parse body for POST requests
      let body: Record<string, unknown> = {};
      if (req.method === 'POST') {
        body = await this.parseBody(req);
      }

      let result: unknown;

      switch (`${req.method} ${path}`) {
        case 'GET /health':
          result = {
            ok: true,
            status: 'running',
            port: this.port,
            pid: process.pid,
            bridgeReady: this.bridgeReady,
          };
          break;

        case 'GET /state':
          result = await this.bridgeExecute('get-state');
          break;

        case 'GET /apps':
          result = await this.bridgeExecute('get-apps');
          break;

        case 'POST /open':
          if (body.appId && !body.path) {
            // Open standalone app
            result = await this.bridgeExecute('open-app', {
              appId: body.appId,
              title: body.title,
            });
          } else if (body.paths && Array.isArray(body.paths)) {
            // Open multiple files
            result = await this.bridgeExecute('open-files', { paths: body.paths, windowId: body.windowId });
          } else if (body.path) {
            // Open single file
            result = await this.bridgeExecute('open-file', {
              path: body.path,
              appId: body.appId,
              windowId: body.windowId,
            });
          } else {
            this.sendError(res, 400, 'Missing path or appId');
            return;
          }
          break;

        case 'POST /close':
          if (body.tabId && body.windowId) {
            result = await this.bridgeExecute('close-tab', {
              windowId: body.windowId,
              tabId: body.tabId,
            });
          } else if (body.windowId) {
            result = await this.bridgeExecute('close-window', {
              windowId: body.windowId,
            });
          } else {
            this.sendError(res, 400, 'Missing windowId');
            return;
          }
          break;

        case 'POST /focus':
          if (!body.windowId) {
            this.sendError(res, 400, 'Missing windowId');
            return;
          }
          result = await this.bridgeExecute('focus-window', {
            windowId: body.windowId,
          });
          break;

        case 'POST /workspace/open':
          if (!body.path) {
            this.sendError(res, 400, 'Missing path');
            return;
          }
          result = await this.bridgeExecute('open-workspace', { path: body.path });
          break;

        case 'POST /workspace/list':
        case 'GET /workspace/list':
          result = await this.bridgeExecute('list-workspaces');
          break;

        case 'POST /terminal':
          if (body.sessionId && body.data) {
            // Write to terminal
            result = await this.bridgeExecute('terminal-write', {
              sessionId: body.sessionId,
              data: body.data,
            });
          } else {
            // Open new terminal
            result = await this.bridgeExecute('open-terminal', {
              windowId: body.windowId,
              cwd: body.cwd,
            });
          }
          break;

        case 'POST /layout':
          if (!body.preset) {
            this.sendError(res, 400, 'Missing preset');
            return;
          }
          result = await this.bridgeExecute('apply-layout', { preset: body.preset });
          break;

        default:
          this.sendError(res, 404, `Unknown endpoint: ${req.method} ${path}`);
          return;
      }

      this.sendJson(res, 200, { ok: true, ...result as object });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(res, 500, message);
    }
  }

  private async bridgeExecute(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.bridgeReady) {
      throw new Error('Renderer bridge is not ready yet');
    }
    // Shares the single dispatch seam with the Lattice mesh node (viewerNode.ts)
    // so control-action translation lives in exactly one place.
    return executeViewerControl(this.getMainWindow(), action, params);
  }

  private parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk: string) => {
        data += chunk;
      });
      req.on('end', () => {
        if (!data) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status);
    res.end(JSON.stringify(data));
  }

  private sendError(res: http.ServerResponse, status: number, message: string): void {
    res.writeHead(status);
    res.end(JSON.stringify({ ok: false, error: message }));
  }
}
