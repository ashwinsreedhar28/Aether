import { contextBridge, ipcRenderer } from 'electron'

// The single bridge surface for the renderer. Every channel here is part of
// the renderer/main contract and should be considered API. Pattern lifted
// from Pulse: typed `window.aether` via contextBridge, no direct
// `ipcRenderer` access in renderer components.

// ---- Mesh types (kept in sync with core/node_sdk_ts) ------------------------

export interface MeshEnvelope {
  id: string
  correlation_id: string
  from: string
  to: string
  kind: 'invocation' | 'response' | 'error'
  payload: Record<string, unknown>
  wrapped?: MeshEnvelope
  timestamp: string
  signature: string
}

export interface MeshInvokeError {
  status: number | null
  message: string
  data?: unknown
}

export interface MeshInvokeResult {
  ok: boolean
  envelope?: MeshEnvelope
  accepted?: { id: string; status: 'accepted' }
  error?: MeshInvokeError
  durationMs: number
}

export type MeshState = 'idle' | 'starting' | 'ready' | 'failed'

export interface MeshStatus {
  coreUrl: string | null
  coreHealthy: boolean
  state: MeshState
  error: string | null
}

// ---- Voice types (kept in sync with daemons/raven-daemon/src/types.ts) ------
// Duplicated rather than imported so the preload (a sandbox-loaded script)
// stays free of cross-package imports.

export type RavenStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

export interface RavenState {
  status: RavenStatus
  pid?: number
  startedAt?: string
  error?: string
}

export interface TranscriptEntry {
  id: string
  // Ties the entry to one child spawn (one conversation). The Chats view groups
  // history by this; live and historical entries both carry it.
  sessionId: string
  timestamp: string
  speaker: 'user' | 'raven' | 'system'
  text: string
}

export interface ToolCallEntry {
  id: string
  timestamp: string
  toolName: string
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
  durationMs?: number
  callId?: string
}

export type VoiceAvailability =
  | { kind: 'available' }
  | { kind: 'unavailable'; reason: string }

export interface VoiceStatus extends RavenState {
  // The live session's id while a child is listening; absent when nothing is.
  // The Chats view badges this session LIVE on mount (exact, not first-push).
  sessionId?: string
  lastTranscript?: TranscriptEntry
  lastToolCall?: ToolCallEntry
}

// ---- Scene types (kept in sync with main/services/sceneSubscriber.ts) ------
// Duplicated rather than imported so the preload (a sandbox-loaded script)
// stays free of cross-package imports.

export interface SceneEventSnapshot {
  type: 'snapshot'
  scene: { version: number; seq: number; panels: unknown[]; entities: unknown[] }
}
export interface SceneEventDelta {
  type: 'delta'
  seq: number
  version: number
  changes: unknown[]
}
export type SceneEvent = SceneEventSnapshot | SceneEventDelta

export interface ScenePostResult {
  ok: boolean
  status?: number
  error?: string
}

// ---- Files types ----------------------------------------------------------

interface FileFilter {
  name: string
  extensions: string[]
}

interface OpenDialogOptions {
  filters?: FileFilter[]
}

// ---- Subscribe helper -----------------------------------------------------

type Unsubscribe = () => void

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// ---- Namespaces -----------------------------------------------------------

const files = {
  /**
   * Native open-file dialog. Returns the absolute path of the chosen file,
   * or null if the user cancelled. `filters` is the standard Electron
   * dialog filter shape (extensions without leading dot).
   */
  openDialog: (opts: OpenDialogOptions = {}): Promise<string | null> =>
    ipcRenderer.invoke('files:openDialog', opts),
  /**
   * UTF-8 read of an absolute path. Rejects if the path is outside the
   * allowed roots (home / userData / downloads / temp), is not a regular
   * file, or exceeds the 1 MiB cap. Errors carry descriptive messages —
   * callers should surface them.
   */
  readText: (path: string): Promise<string> =>
    ipcRenderer.invoke('files:readText', path),
}

const mesh = {
  invoke: (
    target: string,
    payload: Record<string, unknown>,
  ): Promise<MeshInvokeResult> => ipcRenderer.invoke('mesh:invoke', target, payload),
  status: (): Promise<MeshStatus> => ipcRenderer.invoke('mesh:status'),
}

const shellApi = {
  /**
   * Open an http or https URL in the user's default browser. Returns
   * `{ ok: false, reason: ... }` for non-http(s) schemes — never throws.
   */
  openExternal: (url: string): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke('shell:openExternal', url),
}

// Voice namespace — proxies to daemons/raven-daemon over loopback HTTP via
// the main process. None of this is direct: the renderer never opens sockets
// itself, and the daemon never accepts non-loopback traffic.
const voice = {
  availability: (): Promise<VoiceAvailability> => ipcRenderer.invoke('voice:availability'),
  status: (): Promise<VoiceStatus> => ipcRenderer.invoke('voice:status'),
  start: (): Promise<RavenState> => ipcRenderer.invoke('voice:start'),
  stop: (): Promise<RavenState> => ipcRenderer.invoke('voice:stop'),
  // Route a typed turn to raven — the same brain a spoken turn reaches.
  // Resolves {ok:true} on accept, {error} on a cold mic / daemon-down.
  sendText: (text: string): Promise<{ ok: true } | { error: string }> =>
    ipcRenderer.invoke('voice:send-text', text),
  recentTranscripts: (limit = 5): Promise<{ transcripts: TranscriptEntry[] }> =>
    ipcRenderer.invoke('voice:recent-transcripts', limit),
  // Durable transcript history for the Chats view: persisted across sessions,
  // newest last. Returns whatever the daemon's ring holds (seeded from disk on
  // boot), or an empty list if the daemon is unreachable — never throws.
  getTranscripts: (opts: { limit?: number } = {}): Promise<{ transcripts: TranscriptEntry[] }> =>
    ipcRenderer.invoke('voice:get-transcripts', opts.limit ?? 200),
  recentToolCalls: (limit = 5): Promise<{ toolCalls: ToolCallEntry[] }> =>
    ipcRenderer.invoke('voice:recent-tool-calls', limit),
  onAvailabilityChanged: (cb: (a: VoiceAvailability) => void): Unsubscribe =>
    subscribe('voice:availability-changed', cb),
  onStatusChanged: (cb: (s: RavenState) => void): Unsubscribe =>
    subscribe('voice:status-changed', cb),
  onTranscript: (cb: (entry: TranscriptEntry) => void): Unsubscribe =>
    subscribe('voice:transcript', cb),
  onToolCall: (cb: (entry: ToolCallEntry) => void): Unsubscribe =>
    subscribe('voice:tool-call', cb),
}

// Scene namespace — the renderer talks to the scene server only through main.
// Main owns the WS (snapshots + deltas arrive via the 'scene:event' push) and
// proxies panel POSTs over loopback HTTP. The renderer never opens a socket.
const scene = {
  // POST a panel to the scene server. Panel must be a fully-specified SceneDoc
  // panel (id, kind, text/url/data, transform, size, style?).
  // NOTE: panel.style values MUST be strings — the scene server's AVP client
  // decodes style as [String: String]. Numbers/bools break the decode
  // silently. See governance-log 2026-05-26.
  postPanel: (panel: Record<string, unknown>): Promise<ScenePostResult> =>
    ipcRenderer.invoke('scene:post-panel', panel),
  // Subscribe to scene events (snapshot on connect, deltas on mutation).
  // Returns an unsubscribe function.
  onSceneEvent: (cb: (ev: SceneEvent) => void): Unsubscribe =>
    subscribe('scene:event', cb),
  // Read the user's saved Scene arrangement (drag-reordered panel-id sequence).
  // An empty array means no saved order; the Scene falls back to server arrival
  // order. Never throws — a missing/corrupt file resolves to { order: [] }.
  getOrder: (): Promise<{ order: string[] }> => ipcRenderer.invoke('scene:get-order'),
  // Persist a new arrangement: the full panel-id sequence in display order.
  setOrder: (order: string[]): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('scene:set-order', order),
}

const api = {
  signalReady: (): void => {
    ipcRenderer.send('shell:renderer-ready')
  },
  getMetadata: (): Promise<{
    name: string
    version: string
    isDev: boolean
    bootedAt: string
    /** node's process.platform — 'darwin' | 'linux' | 'win32' | ... */
    platform: string
  }> => ipcRenderer.invoke('shell:metadata'),
  files,
  mesh,
  voice,
  scene,
  shell: shellApi,
}

contextBridge.exposeInMainWorld('aether', api)

export type AetherApi = typeof api
