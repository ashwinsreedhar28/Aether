import { runAppleScript } from '@aether/macos-applescript'
import { MAIL_RECENT_INBOX_QUERY } from './queries'
import type { MailStore, InsertArgs } from './storage'

const POLL_INTERVAL_MS = 60_000
const APPLESCRIPT_TIMEOUT_MS = 30_000

export interface PollerOptions {
  store: MailStore
  log: (msg: string) => void
}

export class MailPoller {
  private readonly store: MailStore
  private readonly log: (msg: string) => void
  private intervalHandle: NodeJS.Timeout | null = null
  private polling = false
  private armed = false
  // Debounce permission-denied logging: log once on first denial, then
  // stay quiet until a successful read flips the flag. Without this the
  // log fills up with one message every 60s until the user grants
  // Automation permission via System Settings.
  private deniedLogged = false

  constructor(opts: PollerOptions) {
    this.store = opts.store
    this.log = opts.log
  }

  start(): void {
    if (this.intervalHandle !== null) return
    // Fire one tick immediately so the daemon shows life within seconds
    // (permission_denied logs, or "inserted N" on first batch) rather
    // than waiting POLL_INTERVAL_MS for the first signal.
    void this.tick()
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
    // Re-entrance guard. AppleScript can take 1-3s on slow Mail
    // accounts; a paused or backed-up runtime could queue ticks.
    if (this.polling) return
    this.polling = true
    try {
      const result = await runAppleScript(MAIL_RECENT_INBOX_QUERY, {
        timeoutMs: APPLESCRIPT_TIMEOUT_MS,
      })
      if (!result.ok) {
        if (result.error === 'permission_denied') {
          if (!this.deniedLogged) {
            this.log(
              'Mail.app Automation permission denied. Grant via ' +
                'System Settings → Privacy & Security → Automation. ' +
                'Will keep polling silently until granted.',
            )
            this.deniedLogged = true
          }
        } else {
          this.log(`tick error: ${result.error} — ${result.message}`)
        }
        return
      }
      // First success after a denial: reset debounce so a future denial
      // logs again.
      this.deniedLogged = false

      // Cold-start: drop the first successful tick so the node doesn't
      // backfill the entire inbox on boot. Arm on second tick.
      if (!this.armed) {
        this.armed = true
        return
      }

      const rows = this.parseTsv(result.output)
      if (rows.length === 0) return
      const { inserted } = this.store.insertMany(rows)
      if (inserted > 0) {
        this.log(`inserted ${inserted} new message(s)`)
      }
    } catch (e) {
      this.log(`tick error (unexpected): ${(e as Error).message}`)
    } finally {
      this.polling = false
    }
  }

  // Parse the AppleScript TSV output. Each non-empty line splits by tab
  // into 5 fields: uid, subject, sender, iso_date, read_status_str.
  // Lines that don't have exactly 5 fields or whose date can't be
  // parsed are skipped — one corrupt line doesn't break the batch.
  private parseTsv(output: string): InsertArgs[] {
    const now = Date.now()
    const rows: InsertArgs[] = []
    for (const rawLine of output.split('\n')) {
      const line = rawLine.replace(/\r$/, '')
      if (line.length === 0) continue
      const parts = line.split('\t')
      if (parts.length !== 5) continue
      const [uid, subject, sender, dateIso, readStr] = parts
      if (uid === undefined || subject === undefined || sender === undefined ||
          dateIso === undefined || readStr === undefined) continue
      const t = Date.parse(dateIso)
      if (Number.isNaN(t)) continue
      rows.push({
        uid,
        subject,
        sender,
        dateReceived: t,
        readStatus: readStr === '1' ? 1 : 0,
        capturedAt: now,
      })
    }
    return rows
  }
}
