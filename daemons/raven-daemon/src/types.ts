/**
 * Raven Daemon Types — homeOS build
 *
 * Trimmed from VIEWER's raven-daemon types.ts (SHA 9c58664). Cut:
 *   - VisualMode + camera/screen plumbing (always-none mode here).
 *   - Memory / Tools CRUD types (week-1 has no UI for managing those).
 *   - AudioDevice + AudioDeviceConfig (use system defaults).
 *   - Prompts/Config update types (system defaults only).
 */

// Raven process status, surfaced through both HTTP /status and WS broadcasts.
export type RavenStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

// State held in the daemon and broadcast on every transition.
export interface RavenState {
  status: RavenStatus;
  pid?: number;
  startedAt?: string;
  error?: string;
}

// Transcript line emitted by Raven (one per turn).
export interface TranscriptEntry {
  id: string;
  timestamp: string;
  speaker: 'user' | 'raven' | 'system';
  text: string;
}

// Tool/function call entry. Renamed from VIEWER's FunctionLog for clarity —
// the homeOS shell surfaces these as "recent tool calls" in the Voice app.
export interface ToolCallEntry {
  id: string;
  timestamp: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
  callId?: string;
}

// JSON events the Python child writes one-per-line on stdout.
export type RavenLogEvent =
  | { type: 'status'; timestamp: string; status: string; model?: string; voice?: string }
  | { type: 'transcript'; timestamp: string; speaker: string; text: string }
  | { type: 'function_call'; timestamp: string; name: string; args: Record<string, unknown>; call_id?: string }
  | { type: 'function_result'; timestamp: string; name: string; result: Record<string, unknown>; duration_ms?: number; call_id?: string }
  | { type: 'function_error'; timestamp: string; name: string; error: string; call_id?: string }
  | { type: 'error'; timestamp: string; message: string; errors?: string[] };

// WebSocket channels the shell subscribes to.
export type WsChannel = 'status' | 'transcripts' | 'tool-calls' | 'all';

// Client → daemon WS message.
export type ClientMessage =
  | { type: 'subscribe'; channel: WsChannel }
  | { type: 'unsubscribe'; channel: WsChannel };

// Daemon → client WS message.
export type ServerMessage =
  | { type: 'status'; state: RavenState }
  | { type: 'transcript'; entry: TranscriptEntry }
  | { type: 'tool-call'; entry: ToolCallEntry }
  | { type: 'error'; message: string };

// Response shape for GET /health.
export interface HealthResponse {
  status: 'ok';
  ravenStatus: RavenStatus;
  uptime: number;
}

// Response shape for GET /status — the shell's voice IPC maps this onto the
// renderer's pill states.
export interface StatusResponse extends RavenState {
  lastTranscript?: TranscriptEntry;
  lastToolCall?: ToolCallEntry;
}
