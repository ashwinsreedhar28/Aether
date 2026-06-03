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

  constructor(ravenDir: string, pythonPath: string) {
    super();
    this.ravenDir = ravenDir;
    this.pythonPath = pythonPath;
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
   * Spawn the Python child. Always launches in `--mode none` — vision is
   * vendored but disabled for week-1 voice (see daemons/README.md).
   */
  async start(): Promise<RavenState> {
    if (this.state.status === 'running' || this.state.status === 'starting') {
      return this.state;
    }

    this.updateState({ status: 'starting', error: undefined });

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
    const entry: TranscriptEntry = {
      id: randomUUID(),
      timestamp: event.timestamp,
      speaker: event.speaker as 'user' | 'raven' | 'system',
      text: event.text,
    };
    this.transcriptBuffer.push(entry);
    if (this.transcriptBuffer.length > MAX_TRANSCRIPT_BUFFER) {
      this.transcriptBuffer.shift();
    }
    this.emit('transcript', entry);
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
