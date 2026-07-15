import { contextBridge, ipcRenderer } from 'electron'
// Side-effect import: exposes the absorbed Viewer surface as window.electron
// (fs/app/config/terminal/browser/control/...) alongside window.aether below.
import './viewerApi'
// Gate fold shapes for the monitor push (#378) — type-only, erased at bundle
// time: the fold's shapes have ONE source (the #378 parity law), unlike the
// ledger-record copies below, which mirror main-process types that live
// behind the IPC boundary.
import type { GatePhase, LaneGateState } from '../../src/utils/laneGate'

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

export type SpawnStatus =
  | 'requested'
  | 'spawned'
  | 'closed'
  | 'dismissed'
  | 'failed'
  | 'teardown_failed'

export interface SpawnView {
  id: string
  ts: string
  requestedTs: string
  // Absent/'draft' = draft-prompt spawn; 'lane' = issue-bound lane (#268).
  kind?: 'draft' | 'lane'
  draftName: string
  draftPath: string
  // Lane kind only: the worked issue, its title, the approval batch, and the
  // tmux session owning the spawned process (absent on pty-fallback spawns).
  issue?: number
  issueTitle?: string
  batchId?: string
  tmuxSession?: string
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
  // Full prompt for an actionable 'requested' record — the draft text (draft
  // kind) or the canonical lane kickoff (lane kind).
  preview?: string
  // Copyable teardown block for a worktree we actually created (recorded
  // branch + worktree); present on 'spawned'/'closed' records.
  cleanup?: string
}

// A lane-* tmux session still alive with no terminal attached this app
// lifetime (the relaunch case) — the card offers one-tap reattach. recordId
// (#318) is present ⇔ the backing ledger record is live ('spawned'), so the
// row can also complete it; terminal-record sessions never appear.
export interface OrphanLane {
  session: string
  issue?: number
  worktree?: string
  recordId?: string
}

// A folded "clean, proceed" relay (#310): requested by voice (lane_proceed)
// or the card's PROCEED button; the shell types it into the lane's pane and
// records the outcome.
export type RelayStatus = 'requested' | 'relayed' | 'failed'

export interface RelayRecord {
  id: string
  ts: string
  requestedTs: string
  issue: number
  text: string
  status: RelayStatus
  error?: string
}

// A folded guarded teardown (#317) — voice close_lane or the card's CLOSE OUT;
// the shell runs the canonical cleanup block and records the outcome. A
// 'failed' code of 'dirty' drives the warn card's CLOSE ANYWAY (force);
// 'pr-open' / 'lane-busy' are hard refusals.
export type TeardownStatus = 'requested' | 'done' | 'failed'
export type TeardownGuardCode = 'pr-open' | 'dirty' | 'lane-busy'

export interface TeardownRecord {
  id: string
  ts: string
  requestedTs: string
  issue: number
  force: boolean
  status: TeardownStatus
  code?: TeardownGuardCode
  step?: string
  error?: string
}

export interface SpawnSnapshot {
  spawns: SpawnView[]
  running: string | null
  runningStep: string | null
  // Records queued behind `running` inside the current approval (#268:
  // batch recipes serialize through the single in-flight slot).
  queue: string[]
  busy: boolean
  liveCount: number
  maxLanes: number
  // false ⇔ tmux missing: lanes fall back to ptys that die with the app;
  // the card names the `brew install tmux` remedy.
  tmuxAvailable: boolean
  orphans: OrphanLane[]
  // Folded relays (#310), newest first — the card surfaces a lane's last
  // relay outcome so a voice "proceed lane N" is observable.
  relays: RelayRecord[]
  // Folded teardowns (#317), newest first — same observability for a voice
  // "close out lane N".
  teardowns: TeardownRecord[]
}

export interface SpawnActionResult {
  ok: boolean
  error?: string
  // 'live-session' (#305): complete() refused because the record's tmux
  // session is still alive — re-call with force after an explicit warning.
  // 'pr-open' / 'dirty' / 'lane-busy' (#317): closeLane guard outcomes —
  // only 'dirty' is force-overridable (the warn card's CLOSE ANYWAY).
  code?: 'live-session' | TeardownGuardCode
  // revise() only (#339): true when a DIRECTOR FEEDBACK comment was posted to
  // the issue thread on this call (typed feedback) — lets the card name the
  // post outcome separately from the relay's RELAY row.
  posted?: boolean
}

// The lane monitor's push (#378) — one observed gate transition, with the
// folded gate state riding along so the card merges without a re-fetch.
export interface GateUpdate {
  issue: number
  phase: GatePhase
  prev: GatePhase
  gate: LaneGateState
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
  complete: (id: string, force?: boolean): Promise<SpawnActionResult> =>
    ipcRenderer.invoke('spawn:complete', id, force === true),
  // Reattach an orphaned lane-* tmux session into a fresh terminal window.
  reattach: (session: string): Promise<SpawnActionResult> =>
    ipcRenderer.invoke('spawn:reattach', session),
  // Re-probe tmux and refold the orphan list (#318) — pull-based freshness on
  // Lanes open / card open / explicit refresh. Returns the fresh snapshot.
  refreshOrphans: (): Promise<SpawnSnapshot> => ipcRenderer.invoke('spawn:refresh-orphans'),
  // Relay the fixed "clean, proceed" go-ahead into the live lane working
  // `issue` (#310) — the card's PROCEED button on AT GATE.
  proceed: (issue: number): Promise<SpawnActionResult> =>
    ipcRenderer.invoke('spawn:proceed', issue),
  // The revision loop (#339) — the card's REVISE button on AT GATE/REVISING:
  // post `feedbackText` (when non-empty) to the issue thread as a DIRECTOR
  // FEEDBACK comment, then relay the fixed "revise per the latest DIRECTOR
  // FEEDBACK, then re-gate" into the lane's pane. A failed post relays
  // nothing; `posted` on the result names the post outcome.
  revise: (issue: number, feedbackText?: string): Promise<SpawnActionResult> =>
    ipcRenderer.invoke('spawn:revise', issue, feedbackText),
  // Guarded teardown of the live lane working `issue` (#317) — the card's
  // CLOSE OUT button; `force` only from its CLOSE ANYWAY on the dirty warn.
  closeLane: (issue: number, force?: boolean): Promise<SpawnActionResult> =>
    ipcRenderer.invoke('spawn:close-lane', issue, force === true),
  // Push on every ledger change (request landed, approved, spawned, failed, …).
  onChanged: (cb: (snap: SpawnSnapshot) => void): Unsubscribe => subscribe('spawn:changed', cb),
  // The lane monitor's push (#378): a background-observed gate transition for
  // one lane. The card merges it live; REFRESH stays as the manual override.
  onGateUpdate: (cb: (update: GateUpdate) => void): Unsubscribe =>
    subscribe('spawn:gate-update', cb),
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
