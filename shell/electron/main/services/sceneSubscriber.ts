import { WebSocket } from 'ws'
import { EventEmitter } from 'node:events'

// Main-process WebSocket subscriber to the RAVEN_AVP scene server. The shell
// (not the renderer) owns this socket: the connection survives renderer
// hot-reload, there is exactly one socket per shell instance, and future
// consumers (the Sprint 6.4 visualizer node) can read scene state from a
// single source. The renderer receives scene events via IPC push and POSTs
// panels via IPC invoke — it never opens a socket itself.
//
// This subscriber is READ-ONLY: it consumes the WS and forwards whatever
// arrives. POSTing panels is the IPC handler's job (see index.ts).
//
// WS + reconnect shape mirrors ravenDaemonManager.ts:562-609.

const DEFAULT_URL = 'ws://127.0.0.1:5180/scene/stream'

// Reconnect backoff schedule (ms), matching the daemon-manager convention.
// The index advances on each closed/failed connection and caps at the last
// entry, so reconnect attempts settle at one every 30s.
const BACKOFF_SCHEDULE_MS = [1000, 2000, 5000, 10000, 30000]

export interface SceneSnapshot {
  type: 'snapshot'
  scene: { version: number; seq: number; panels: unknown[]; entities: unknown[] }
}
export interface SceneDelta {
  type: 'delta'
  seq: number
  version: number
  changes: unknown[]
}
export type SceneEvent = SceneSnapshot | SceneDelta

/**
 * Owns the WS lifecycle to the scene server. Emits:
 *   - 'scene-event' (SceneEvent) on each snapshot/delta frame
 *   - 'connection-changed' (boolean) on connect/disconnect transitions
 *
 * start() is idempotent; stop() halts reconnection.
 */
export class SceneSubscriber extends EventEmitter {
  private readonly url: string
  private ws: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private backoffIndex = 0
  private intentionallyStopped = false
  private connected = false

  constructor(url: string = DEFAULT_URL) {
    super()
    this.url = url
  }

  /** Begin the connect loop. Idempotent — a no-op if already connecting/open. */
  start(): void {
    this.intentionallyStopped = false
    this.connect()
  }

  /**
   * Close the WS and halt reconnection. Sets an intentionally-stopped flag so
   * the close handler does not schedule another reconnect, and clears any
   * pending reconnect timer.
   */
  stop(): void {
    this.intentionallyStopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      // Drop listeners first so the 'close' handler can't re-arm a reconnect.
      this.ws.removeAllListeners()
      try {
        this.ws.close()
      } catch {
        // already closing/closed — ignore
      }
      this.ws = null
    }
    this.setConnected(false)
  }

  isConnected(): boolean {
    return this.connected
  }

  private connect(): void {
    if (this.intentionallyStopped) return
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    let ws: WebSocket
    try {
      ws = new WebSocket(this.url)
    } catch (e) {
      console.error('[sceneSubscriber] ws ctor failed', e)
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.on('open', () => {
      // The scene server pushes a snapshot automatically on accept — there is
      // nothing to subscribe to here. Reset backoff now that we're live.
      this.backoffIndex = 0
      this.setConnected(true)
    })

    ws.on('message', (data) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(data.toString())
      } catch {
        console.warn('[sceneSubscriber] dropping malformed frame')
        return
      }
      const type = (parsed as { type?: unknown }).type
      if (type === 'snapshot' || type === 'delta') {
        // Forward as-is; the renderer (Sprint 6.3b) interprets the shapes.
        this.emit('scene-event', parsed as SceneEvent)
      } else {
        // Tolerate unknown message types — log and ignore.
        console.log('[sceneSubscriber] ignoring unknown message type:', type)
      }
    })

    ws.on('close', () => {
      this.ws = null
      this.setConnected(false)
      // 'error' is always followed by 'close'; let close drive reconnect so we
      // schedule exactly once per failed connection.
      this.scheduleReconnect()
    })

    ws.on('error', (err: Error) => {
      console.error('[sceneSubscriber] ws error', err.message)
    })
  }

  private scheduleReconnect(): void {
    if (this.intentionallyStopped) return
    if (this.reconnectTimer) return
    const delay =
      BACKOFF_SCHEDULE_MS[Math.min(this.backoffIndex, BACKOFF_SCHEDULE_MS.length - 1)] ?? 30000
    this.backoffIndex += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private setConnected(value: boolean): void {
    if (this.connected === value) return
    this.connected = value
    this.emit('connection-changed', value)
  }
}
