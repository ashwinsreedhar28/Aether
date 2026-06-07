/**
 * Raven Manager — supervises the Python raven-core child process.
 *
 * Trimmed from VIEWER's ravenManager.ts (SHA 9c58664). Cut:
 *   - VisualMode plumbing (always-none mode: voice only).
 *   - AudioDeviceConfig arg threading (system defaults only).
 *   - setMode method (no mode-switch UI).
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as readline from 'readline';
import { randomUUID } from 'crypto';
import { TranscriptStore, redactSecrets } from './transcriptStore';
import type {
  RavenState,
  RavenStatus,
  TranscriptEntry,
  ToolCallEntry,
  RavenLogEvent,
} from './types';

const MAX_TRANSCRIPT_BUFFER = 200;
const MAX_TOOL_CALL_BUFFER = 200;

export class RavenManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private state: RavenState = { status: 'stopped' };
  private transcriptBuffer: TranscriptEntry[] = [];
  private toolCallBuffer: ToolCallEntry[] = [];
  private ravenDir: string;
  private pythonPath: string;
  private store: TranscriptStore;
  // One session per child spawn (set in start()). Empty until the first spawn;
  // transcripts only arrive while a child is alive, so it is always set by then.
  private sessionId = '';

  constructor(ravenDir: string, pythonPath: string, dataDir: string) {
    super();
    this.ravenDir = ravenDir;
    this.pythonPath = pythonPath;
    this.store = new TranscriptStore(dataDir);
    // Seed the ring from disk so /transcripts serves prior-session history the
    // moment the daemon is up — before any new turn. The ring stays the hot
    // path; this is just its durable tail loaded back in.
    this.transcriptBuffer = this.store.loadRecent(MAX_TRANSCRIPT_BUFFER);
  }

  getState(): RavenState {
    return { ...this.state };
  }

  getTranscripts(limit?: number): TranscriptEntry[] {
    const transcripts = [...this.transcriptBuffer];
    if (limit && limit > 0) return transcripts.slice(-limit);
    return transcripts;
  }

  getToolCalls(limit?: number): ToolCallEntry[] {
    const calls = [...this.toolCallBuffer];
    if (limit && limit > 0) return calls.slice(-limit);
    return calls;
  }

  lastTranscript(): TranscriptEntry | undefined {
    return this.transcriptBuffer[this.transcriptBuffer.length - 1];
  }

  lastToolCall(): ToolCallEntry | undefined {
    return this.toolCallBuffer[this.toolCallBuffer.length - 1];
  }

  /**
   * The id of the session that is live right now. Set only while a child is
   * actually spawned, so a freshly-booted daemon (no child yet) and a stopped
   * session both report `undefined` — the in-memory `sessionId` lingers as the
   * last spawn's id, but we gate on a live process so it's never reported stale.
   * Surfaced via /status so the Chats view can badge the live session on mount
   * without waiting for its first transcript push.
   */
  liveSessionId(): string | undefined {
    return this.process && this.sessionId ? this.sessionId : undefined;
  }

  /**
   * Spawn the Python child. Always launches in `--mode none` — vision is
   * vendored but disabled for week-1 voice (see daemons/README.md).
   */
  async start(): Promise<RavenState> {
    if (this.state.status === 'running' || this.state.status === 'starting') {
      return this.state;
    }

    this.updateState({ status: 'starting', error: undefined });

    // New child = new conversation session. Tag every entry from this spawn
    // with this id and route its persistence to a fresh JSONL file.
    this.sessionId = randomUUID();
    this.store.openSession(this.sessionId);

    const mainScript = path.join(this.ravenDir, 'main.py');
    const args = [mainScript, '--mode', 'none', '--json-output'];

    console.log(`[RavenManager] Spawning ${this.pythonPath} ${args.join(' ')}`);

    try {
      this.process = spawn(this.pythonPath, args, {
        cwd: this.ravenDir,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (this.process.stdout) {
        const rl = readline.createInterface({
          input: this.process.stdout,
          crlfDelay: Infinity,
        });
        rl.on('line', (line) => this.parseLogLine(line));
      }

      if (this.process.stderr) {
        const rl = readline.createInterface({
          input: this.process.stderr,
          crlfDelay: Infinity,
        });
        rl.on('line', (line) => {
          console.error('[Raven stderr]', line);
        });
      }

      this.process.on('exit', (code, signal) => {
        console.log(`[RavenManager] Python exited code=${code} signal=${signal}`);
        this.process = null;
        this.updateState({
          status: 'stopped',
          pid: undefined,
          startedAt: undefined,
          error: code !== 0 && code !== null ? `Exited with code ${code}` : undefined,
        });
      });

      this.process.on('error', (error) => {
        console.error('[RavenManager] Python spawn error:', error);
        this.process = null;
        this.updateState({ status: 'error', error: error.message });
        this.emit('error', error.message);
      });

      this.updateState({
        status: 'starting',
        pid: this.process.pid,
        startedAt: new Date().toISOString(),
      });

      return this.state;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateState({ status: 'error', error: message });
      this.emit('error', message);
      throw error;
    }
  }

  /**
   * Forward a typed user turn to the live session. Writes a JSON envelope
   * line to the child's stdin, where orchestrator.send_text reads it and
   * injects it via send_client_content — the same brain a spoken turn
   * reaches. JSON (not a bare line) so a user typing literally "q" or a
   * multi-line message can't trip the 'q\n' shutdown sentinel that shares
   * this stdin channel (see stop()).
   *
   * Returns false when there's no live session to inject into — no running
   * child or a destroyed stdin. The HTTP layer maps that to 409 no_session.
   * Acceptance only: the model's reply arrives as audio + the existing
   * transcript / tool-call pushes, not on this call's return.
   */
  sendText(text: string): boolean {
    if (this.state.status !== 'running') return false;
    if (!this.process || !this.process.stdin || this.process.stdin.destroyed) {
      return false;
    }
    this.process.stdin.write(JSON.stringify({ type: 'text', text }) + '\n');
    // Typed turns produce no spoken audio, so raven-core emits no 'user'
    // transcript for them (unlike a spoken turn). Synthesize one here so the
    // typed line lands in the same transcript stream — persisted, ringed, and
    // pushed over WS — exactly like every other turn. The shell CLI and the
    // Chats view both render it from this one push (no optimistic local echo).
    this.recordTranscript({
      id: randomUUID(),
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      speaker: 'user',
      text,
    });
    return true;
  }

  /**
   * Stop the Python child. SIGTERM first, 5s grace, then SIGKILL.
   */
  async stop(): Promise<RavenState> {
    if (!this.process || this.state.status === 'stopped') {
      return this.state;
    }

    this.updateState({ status: 'stopping' });

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process) {
          console.log('[RavenManager] Grace expired — sending SIGKILL');
          this.process.kill('SIGKILL');
        }
      }, 5000);

      if (this.process) {
        this.process.once('exit', () => {
          clearTimeout(timeout);
          this.process = null;
          this.updateState({ status: 'stopped', pid: undefined, startedAt: undefined });
          resolve(this.state);
        });

        this.process.kill('SIGTERM');

        // raven-core's main.py also accepts 'q\n' on stdin for graceful shutdown.
        if (this.process.stdin && !this.process.stdin.destroyed) {
          this.process.stdin.write('q\n');
        }
      } else {
        clearTimeout(timeout);
        this.updateState({ status: 'stopped' });
        resolve(this.state);
      }
    });
  }

  private parseLogLine(line: string): void {
    if (!line) return;
    try {
      const event = JSON.parse(line) as RavenLogEvent;
      this.handleLogEvent(event);
    } catch {
      // Non-JSON output — propagate to console for debugging.
      console.log('[Raven stdout]', line);
    }
  }

  private handleLogEvent(event: RavenLogEvent): void {
    switch (event.type) {
      case 'status':
        this.handleStatusEvent(event);
        break;
      case 'transcript':
        this.handleTranscriptEvent(event);
        break;
      case 'function_call':
        this.handleFunctionCallEvent(event);
        break;
      case 'function_result':
        this.handleFunctionResultEvent(event);
        break;
      case 'function_error':
        this.handleFunctionErrorEvent(event);
        break;
      case 'error':
        this.emit('error', event.message);
        break;
    }
  }

  private handleStatusEvent(event: Extract<RavenLogEvent, { type: 'status' }>): void {
    const statusMap: Record<string, RavenStatus> = {
      loading_config: 'starting',
      initialized: 'starting',
      connecting: 'starting',
      connected: 'running',
      running: 'running',
      stopping: 'stopping',
      stopped: 'stopped',
      interrupted: 'stopped',
    };
    const status = statusMap[event.status] || this.state.status;
    this.updateState({ status });
  }

  private handleTranscriptEvent(event: Extract<RavenLogEvent, { type: 'transcript' }>): void {
    this.recordTranscript({
      id: randomUUID(),
      sessionId: this.sessionId,
      timestamp: event.timestamp,
      speaker: event.speaker as 'user' | 'raven' | 'system',
      text: event.text,
    });
  }

  /**
   * The single sink for a finished transcript entry: persist it (durable tail),
   * push it onto the in-memory ring (hot path, capped), and emit it for the WS
   * broadcast. Used by both the raven-core stream and the synthetic typed-user
   * turn so they share one code path.
   */
  private recordTranscript(entry: TranscriptEntry): void {
    // Scrub the spawn passphrase once, here, so the SAME redacted entry flows to
    // all three sinks — persist (store.append re-scrubs defensively), the
    // in-memory ring served to the Chats view, and the WS broadcast. Redacting
    // only at persist would leave the live ring carrying the phrase until restart.
    const safe = { ...entry, text: redactSecrets(entry.text) };
    this.store.append(safe);
    this.transcriptBuffer.push(safe);
    if (this.transcriptBuffer.length > MAX_TRANSCRIPT_BUFFER) {
      this.transcriptBuffer.shift();
    }
    this.emit('transcript', safe);
  }

  private handleFunctionCallEvent(event: Extract<RavenLogEvent, { type: 'function_call' }>): void {
    const entry: ToolCallEntry = {
      id: randomUUID(),
      timestamp: event.timestamp,
      toolName: event.name,
      args: event.args,
      callId: event.call_id,
    };
    this.toolCallBuffer.push(entry);
    if (this.toolCallBuffer.length > MAX_TOOL_CALL_BUFFER) {
      this.toolCallBuffer.shift();
    }
    this.emit('toolCall', entry);
  }

  private handleFunctionResultEvent(event: Extract<RavenLogEvent, { type: 'function_result' }>): void {
    const existing = this.toolCallBuffer.find(
      (c) => c.callId === event.call_id && !c.result && !c.error
    );
    if (existing) {
      existing.result = event.result;
      existing.durationMs = event.duration_ms;
      this.emit('toolCall', existing);
    }
  }

  private handleFunctionErrorEvent(event: Extract<RavenLogEvent, { type: 'function_error' }>): void {
    const existing = this.toolCallBuffer.find(
      (c) => c.callId === event.call_id && !c.result && !c.error
    );
    if (existing) {
      existing.error = event.error;
      this.emit('toolCall', existing);
    }
  }

  private updateState(updates: Partial<RavenState>): void {
    this.state = { ...this.state, ...updates };
    this.emit('status', this.state);
  }
}
