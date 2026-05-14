/**
 * Raven Daemon — Aether build
 *
 * HTTP + WebSocket server in front of a Python raven-core child. The
 * Aether shell spawns this daemon detached on boot and talks to it via
 * 127.0.0.1:7433. Trimmed from VIEWER's daemon (SHA 9c58664): removed
 * memory/tools/config/audio CRUD routes and visual-mode plumbing.
 *
 * Environment:
 *   RAVEN_DAEMON_PORT       Port to bind (default 7433).
 *   RAVEN_DAEMON_DATA_DIR   Where to drop daemon.pid (default ~/.raven).
 *   RAVEN_DIR               Path to the raven-core Python dir.
 *   RAVEN_PYTHON            Path to the Python interpreter to spawn.
 *   RAVEN_USER_DIR          User data dir for raven-core (memory.json,
 *                           prompts.json overrides). Forwarded to the
 *                           Python child via inherited environment.
 *
 * Endpoints (HTTP, loopback-only):
 *   GET  /health         liveness probe — used by the shell to detect
 *                        an already-running daemon
 *   GET  /status         current RavenState plus lastTranscript /
 *                        lastToolCall
 *   POST /listen/start   spawn the Python child and begin listening
 *   POST /listen/stop    stop the Python child
 *
 * WebSocket (same port):
 *   subscribe to channels "status" | "transcripts" | "tool-calls" | "all".
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import { RavenManager } from './ravenManager';
import type {
  RavenState,
  HealthResponse,
  StatusResponse,
  ClientMessage,
  ServerMessage,
  WsChannel,
} from './types';

const PORT = parseInt(process.env.RAVEN_DAEMON_PORT || '7433', 10);
const RAVEN_DIR =
  process.env.RAVEN_DIR || path.resolve(__dirname, '../../raven-core');
const PYTHON_PATH = process.env.RAVEN_PYTHON || 'python3';
const DATA_DIR =
  process.env.RAVEN_DAEMON_DATA_DIR || path.join(os.homedir(), '.raven');

const ravenManager = new RavenManager(RAVEN_DIR, PYTHON_PATH);

interface WsClient {
  ws: WebSocket;
  subscriptions: Set<WsChannel>;
}
const wsClients: Set<WsClient> = new Set();
const startTime = Date.now();

function parseBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? (JSON.parse(body) as T) : ({} as T));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

function broadcast(channel: WsChannel, message: ServerMessage): void {
  const data = JSON.stringify(message);
  for (const client of wsClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (client.subscriptions.has('all') || client.subscriptions.has(channel)) {
      client.ws.send(data);
    }
  }
}

ravenManager.on('status', (state: RavenState) => {
  broadcast('status', { type: 'status', state });
});
ravenManager.on('transcript', (entry) => {
  broadcast('transcripts', { type: 'transcript', entry });
});
ravenManager.on('toolCall', (entry) => {
  broadcast('tool-calls', { type: 'tool-call', entry });
});
ravenManager.on('error', (message: string) => {
  broadcast('status', { type: 'error', message });
});

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const method = req.method || 'GET';
  const pathname = url.pathname;

  try {
    if (pathname === '/health' && method === 'GET') {
      const response: HealthResponse = {
        status: 'ok',
        ravenStatus: ravenManager.getState().status,
        uptime: Date.now() - startTime,
      };
      sendJson(res, 200, response);
      return;
    }

    if (pathname === '/status' && method === 'GET') {
      const response: StatusResponse = {
        ...ravenManager.getState(),
        lastTranscript: ravenManager.lastTranscript(),
        lastToolCall: ravenManager.lastToolCall(),
      };
      sendJson(res, 200, response);
      return;
    }

    if (pathname === '/listen/start' && method === 'POST') {
      await parseBody(req);
      const state = await ravenManager.start();
      sendJson(res, 200, state);
      return;
    }

    if (pathname === '/listen/stop' && method === 'POST') {
      const state = await ravenManager.stop();
      sendJson(res, 200, state);
      return;
    }

    if (pathname === '/transcripts' && method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      sendJson(res, 200, { transcripts: ravenManager.getTranscripts(limit) });
      return;
    }

    if (pathname === '/tool-calls' && method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      sendJson(res, 200, { toolCalls: ravenManager.getToolCalls(limit) });
      return;
    }

    sendError(res, 404, 'Not found');
  } catch (error) {
    console.error('[daemon] request error:', error);
    sendError(res, 500, error instanceof Error ? error.message : 'Internal error');
  }
}

function handleWebSocket(ws: WebSocket): void {
  const client: WsClient = { ws, subscriptions: new Set() };
  wsClients.add(client);
  console.log('[daemon] WS client connected');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString()) as ClientMessage;
      if (message.type === 'subscribe') {
        client.subscriptions.add(message.channel);
      } else if (message.type === 'unsubscribe') {
        client.subscriptions.delete(message.channel);
      }
    } catch (error) {
      console.error('[daemon] WS message parse error:', error);
    }
  });

  ws.on('close', () => {
    wsClients.delete(client);
  });

  ws.on('error', (error) => {
    console.error('[daemon] WS error:', error);
    wsClients.delete(client);
  });

  // Send current state immediately so a freshly-connected client doesn't
  // have to poll /status before painting.
  const initial: ServerMessage = { type: 'status', state: ravenManager.getState() };
  ws.send(JSON.stringify(initial));
}

const server = http.createServer(handleRequest);
const wss = new WebSocketServer({ server });
wss.on('connection', handleWebSocket);

fs.mkdirSync(DATA_DIR, { recursive: true });
const pidFile = path.join(DATA_DIR, 'daemon.pid');
fs.writeFileSync(pidFile, String(process.pid));

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[daemon] Shutting down (${signal})...`);

  try {
    fs.unlinkSync(pidFile);
  } catch {
    // already gone
  }

  // Stop the Python child first, then close servers + sockets.
  ravenManager.stop().finally(() => {
    for (const client of wsClients) {
      try {
        client.ws.close();
      } catch {
        // ignore
      }
    }
    wss.close();
    server.close(() => process.exit(0));
    // Hard exit if server.close hangs (rare; usually a dangling socket).
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[daemon] listening on http://127.0.0.1:${PORT}`);
  console.log(`[daemon] raven-core dir: ${RAVEN_DIR}`);
  console.log(`[daemon] python: ${PYTHON_PATH}`);
  console.log(`[daemon] pid file: ${pidFile}`);
});
