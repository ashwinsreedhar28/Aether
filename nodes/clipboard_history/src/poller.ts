import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import type { ClipboardStore } from './storage'

const execFileAsync = promisify(execFile)

const POLL_INTERVAL_MS = 500
const PBPASTE_TIMEOUT_MS = 2000
const RECENT_HASH_RING_SIZE = 20
const RETENTION_KEEP = 1000

export interface PollerOptions {
  store: ClipboardStore
  log: (msg: string) => void
}

export class ClipboardPoller {
  private readonly store: ClipboardStore
  private readonly log: (msg: string) => void
  private intervalHandle: NodeJS.Timeout | null = null
  private readonly recentHashes: string[] = []
  private armed = false
  private polling = false

  constructor(opts: PollerOptions) {
    this.store = opts.store
    this.log = opts.log
  }

  start(): void {
    if (this.intervalHandle !== null) return
    this.intervalHandle = setInterval(() => {
      void this.tick()
    }, POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
  }

  private async tick(): Promise<void> {
    // Re-entrance guard. A slow pbpaste or a paused process could queue
    // ticks; we drop the new one rather than stacking work.
    if (this.polling) return
    this.polling = true
    try {
      const content = await this.readClipboard()
      if (content === null) return
      const hash = createHash('sha256').update(content).digest('hex')

      // In-memory ring buffer short-circuits SQLite for the common case
      // (the user is rarely actively copying — the same content sits on
      // the pasteboard between captures).
      if (this.recentHashes.includes(hash)) return
      this.recentHashes.push(hash)
      if (this.recentHashes.length > RECENT_HASH_RING_SIZE) {
        this.recentHashes.shift()
      }

      // Cold-start: drop the very first capture so the node doesn't
      // log whatever was on the user's clipboard when Aether started.
      // Arms on the second tick.
      if (!this.armed) {
        this.armed = true
        return
      }

      const inserted = this.store.insert({
        contentHash: hash,
        content,
        contentType: 'text/plain',
        capturedAt: Date.now(),
      })
      if (inserted) {
        this.store.prune(RETENTION_KEEP)
      }
    } catch (e) {
      this.log(`tick error: ${(e as Error).message}`)
    } finally {
      this.polling = false
    }
  }

  private async readClipboard(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('pbpaste', [], {
        encoding: 'utf8',
        timeout: PBPASTE_TIMEOUT_MS,
      })
      if (stdout.length === 0) return null
      return stdout
    } catch {
      // pbpaste failed (timeout, killed, missing). Surface null;
      // caller treats it as no-op for this tick.
      return null
    }
  }
}
