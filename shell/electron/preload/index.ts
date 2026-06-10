import { contextBridge, ipcRenderer } from 'electron'
// Side-effect import: exposes the absorbed Viewer surface as window.electron
// (fs/app/config/terminal/browser/control/...) alongside window.aether below.
import './viewerApi'

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

// ---- Spawn types (kept in sync with main/services/spawnService.ts) ----------
// Duplicated rather than imported so the preload (a sandbox-loaded script)
// stays free of cross-package imports.

export type SpawnStatus = 'requested' | 'spawned' | 'closed' | 'dismissed' | 'failed'

export interface SpawnView {
  id: string
  ts: string
  requestedTs: string
  draftName: string
  draftPath: string
  status: SpawnStatus
  worktree?: string
  branch?: string
  step?: string
  error?: string
  // Best-effort RAG bootstrap outcome, recorded on the 'spawned' event.
  ragBootstrap?: 'ok' | 'failed'
  ragStep?: string
  // Derived target for the card (before the worktree exists).
  targetBranch: string
  targetWorktree: string
  // Full draft prompt, attached only to an actionable 'requested' record.
  preview?: string
  // Copyable teardown block for a worktree we actually created (recorded
  // branch + worktree); present on 'spawned'/'closed' records.
  cleanup?: string
}

export interface SpawnSnapshot {
  spawns: SpawnView[]
  running: string | null
  runningStep: string | null
  busy: boolean
}

export interface SpawnActionResult {
  ok: boolean
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
  // Mute toggle (mic off + ambient-listen suppressed). Synced across renderers.
  muted: (): Promise<boolean> => ipcRenderer.invoke('voice:muted'),
  setMuted: (muted: boolean): Promise<{ muted: boolean }> =>
    ipcRenderer.invoke('voice:set-muted', muted),
  onMutedChanged: (cb: (muted: boolean) => void): Unsubscribe =>
    subscribe('voice:muted-changed', cb),
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

// Spawn namespace — the spawn actor's approval card + Spawns strip. The
// passphrase never reaches the renderer; it is verified inside raven-core before
// a request lands in the ledger. The renderer only lists requests, approves,
// dismisses, or marks them complete.
const spawn = {
  list: (): Promise<SpawnSnapshot> => ipcRenderer.invoke('spawn:list'),
  approve: (id: string): Promise<SpawnActionResult> => ipcRenderer.invoke('spawn:approve', id),
  dismiss: (id: string): Promise<SpawnActionResult> => ipcRenderer.invoke('spawn:dismiss', id),
  complete: (id: string): Promise<SpawnActionResult> => ipcRenderer.invoke('spawn:complete', id),
  // Push on every ledger change (request landed, approved, spawned, failed, …).
  onChanged: (cb: (snap: SpawnSnapshot) => void): Unsubscribe => subscribe('spawn:changed', cb),
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
  spawn,
  shell: shellApi,
}

contextBridge.exposeInMainWorld('aether', api)

export type AetherApi = typeof api
