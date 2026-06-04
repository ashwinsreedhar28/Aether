import { runAppleScript } from '@aether/macos-applescript'
import { MAIL_RECENT_INBOX_QUERY, buildSingleBodyQuery } from './queries'
import type { MailStore, InsertArgs } from './storage'

const POLL_INTERVAL_MS = 60_000
const APPLESCRIPT_TIMEOUT_MS = 30_000

// Final cap on the stored body, in characters. Bodies are spoken aloud by
// RAVEN, so this bounds a single read to a sane length; anything longer is
// truncated and flagged via bodyTruncated. The AppleScript layer applies a
// coarser 4000-char source cap before transfer; this is the post-normalize
// cap on the spoken text.
const FINAL_BODY_CAP = 1500

// How many of the newest messages we keep bodies for. Body capture is slow,
// so it's scoped to the few most-recent — enough for "read me my latest
// email" and recent digests.
const BODY_WINDOW = 3

// Per-message body-fetch timeout. `content of msg` rides on Mail.app's
// variable Apple-Event latency (sub-second when healthy, tens of seconds when
// the app is busy) plus the body decode — measured 31-45s for one message
// during moderate slowness. The budget covers that with margin; a message
// that still doesn't return is abandoned and retried next tick. We fetch
// exactly ONE message per tick, so the header poll plus one body call stays
// under the 60s interval; the re-entrance guard backstops the rare overrun.
const PER_BODY_TIMEOUT_MS = 50_000

// Give up fetching a message's body after this many failed/empty attempts so
// a permanently-unreadable top-N slot stops burning AppleScript time every
// tick. Kept in sync with the store's MAX_BODY_ATTEMPTS selection bound.
const MAX_BODY_ATTEMPTS = 3

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
  // Running count of consecutive body-fetch failures (bridge timeouts /
  // errors), reset on the next successful fetch. Surfaced in the log so a
  // systemic body-capture breakage is visible rather than silently degrading
  // to subject-only reads.
  private bodyFetchFailures = 0

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
    // Re-entrance guard. The header poll is fast (~1-3s) but the body
    // backfill pass adds up to BODY_FETCH_COUNT serial bridge calls; a slow
    // tick must not overlap the next interval.
    if (this.polling) return
    this.polling = true
    try {
      const result = await runAppleScript(MAIL_RECENT_INBOX_QUERY, {
        timeoutMs: APPLESCRIPT_TIMEOUT_MS,
      })
      // Record header-poll health in the DB (visible via SELECT * FROM
      // mail_meta) — this SQLite write lands even when the Mail query itself
      // timed out, so a stalled poll is observable instead of silent.
      this.store.setMeta('last_header_at', new Date().toISOString())
      if (!result.ok) {
        this.store.setMeta('last_header_status', result.error)
        this.store.setMeta('last_header_error', result.message)
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
      this.store.setMeta('last_header_status', 'ok')
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
      if (rows.length > 0) {
        const { inserted } = this.store.insertMany(rows)
        if (inserted > 0) {
          this.log(`inserted ${inserted} new message(s)`)
        }
      }

      // Body capture runs as a separate, bounded per-message pass — see
      // backfillBodies. Operates on stored rows, so it runs regardless of
      // whether this tick inserted new headers.
      await this.backfillBodies()
    } catch (e) {
      this.log(`tick error (unexpected): ${(e as Error).message}`)
    } finally {
      this.polling = false
    }
  }

  // Fetch and store ONE body per tick — the newest message in the BODY_WINDOW
  // that still lacks one. A single per-message bridge call (not a batch)
  // isolates faults: a slow or unreadable message can't take its siblings'
  // fetches down with it, and the failure counter stays per-message granular.
  // One per tick (rather than the whole window) keeps each tick under the 60s
  // interval given how slow `content` can be under Mail latency; the window
  // fills over a few ticks, newest first. A message that fails or returns no body
  // MAX_BODY_ATTEMPTS times is written off (the store stops selecting it), so
  // a poisoned slot doesn't burn AppleScript time every tick.
  private async backfillBodies(): Promise<void> {
    // Pick the newest still-needing-body message (body NULL, attempts left).
    // Rank i (0-based) ≈ inbox position i+1 (both newest-first); the header
    // poll ran moments ago so the orderings align. We backfill by the uid
    // actually returned, so a rare tie/drift still fills a real recent row.
    const top = this.store.topRows(BODY_WINDOW)
    let targetPosition = -1
    let target: { uid: string; bodyAttempts: number } | null = null
    for (let i = 0; i < top.length; i++) {
      const row = top[i]
      if (row === undefined || row.body !== null) continue
      if (row.bodyAttempts >= MAX_BODY_ATTEMPTS) continue
      targetPosition = i + 1
      target = { uid: row.uid, bodyAttempts: row.bodyAttempts }
      break
    }
    if (target === null) {
      // top-N all filled or written off — nothing to do
      this.store.setMeta('last_body_status', 'idle_window_filled')
      return
    }

    this.store.setMeta('last_body_at', new Date().toISOString())
    const res = await runAppleScript(buildSingleBodyQuery(targetPosition), {
      timeoutMs: PER_BODY_TIMEOUT_MS,
    })

    if (!res.ok) {
      this.bodyFetchFailures += 1
      this.store.bumpBodyAttempt(target.uid)
      this.store.setMeta('last_body_status', res.error)
      this.store.setMeta('last_body_error', res.message)
      this.store.setMeta('body_fetch_failures', String(this.bodyFetchFailures))
      // Visible failure signal — body capture breaking must not be silent.
      this.log(
        `body fetch failed: ${res.error} — ${res.message} ` +
          `(consecutive failures: ${this.bodyFetchFailures}; ` +
          `attempt ${target.bodyAttempts + 1}/${MAX_BODY_ATTEMPTS} this message)`,
      )
      return
    }

    // A successful bridge call clears the consecutive-failure streak.
    if (this.bodyFetchFailures > 0) {
      this.log(`body fetch recovered after ${this.bodyFetchFailures} failure(s)`)
      this.bodyFetchFailures = 0
    }
    this.store.setMeta('body_fetch_failures', '0')

    const parsed = this.parseSingleBody(res.output)
    if (parsed !== null && parsed.body !== null) {
      if (this.store.backfillBody(parsed.uid, parsed.body, parsed.bodyTruncated)) {
        this.store.setMeta('last_body_status', 'ok')
        this.store.setMeta('last_backfill_at', new Date().toISOString())
        this.log(`backfilled body for 1 message`)
      }
    } else {
      // Fetch succeeded but the message has no readable body — count an
      // attempt so an empty/blocked body isn't re-fetched forever.
      this.store.bumpBodyAttempt(target.uid)
      this.store.setMeta('last_body_status', 'empty_body')
    }
  }

  // Parse the header-poll TSV. Each non-empty line splits by tab into 5
  // fields: uid, subject, sender, iso_date, read_status_str. Lines that
  // don't have exactly 5 fields or whose date can't be parsed are skipped —
  // one corrupt line doesn't break the batch.
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

  // Parse a single-message body record: <uid>\t<body_truncated 0|1>\t<body>.
  // Any stray newlines (osascript's trailing one, or a separator that slipped
  // the AppleScript fold) are flattened to spaces — it's one record, so
  // flattening is safe. Returns null if the record is malformed.
  private parseSingleBody(
    output: string,
  ): { uid: string; body: string | null; bodyTruncated: number } | null {
    const line = output.replace(/[\r\n]+/g, ' ').trim()
    if (line.length === 0) return null
    const parts = line.split('\t')
    if (parts.length < 3) return null
    const uid = parts[0]
    const bodyTruncStr = parts[1]
    if (uid === undefined || uid.length === 0 || bodyTruncStr === undefined) return null
    const bodyRaw = parts.slice(2).join(' ')
    const { body, bodyTruncated } = this.normalizeBody(bodyRaw, bodyTruncStr === '1')
    return { uid, body, bodyTruncated }
  }

  // Normalize a captured body for storage. AppleScript already folded
  // tabs/newlines to spaces and source-capped at 4000 chars; here we
  // collapse the remaining whitespace runs, trim, and apply the final
  // FINAL_BODY_CAP. An empty result (genuinely empty body OR one that
  // couldn't be read) maps to null — never a surface error. bodyTruncated
  // is 1 if either the source cap fired or the final cap fired.
  private normalizeBody(
    raw: string,
    sourceTruncated: boolean,
  ): { body: string | null; bodyTruncated: number } {
    const normalized = raw.replace(/\s+/g, ' ').trim()
    if (normalized.length === 0) {
      return { body: null, bodyTruncated: 0 }
    }
    let body = normalized
    let truncated = sourceTruncated
    if (body.length > FINAL_BODY_CAP) {
      body = body.slice(0, FINAL_BODY_CAP).trimEnd()
      truncated = true
    }
    return { body, bodyTruncated: truncated ? 1 : 0 }
  }
}
