import type { MeshNode } from '@aether/mesh-node-sdk'
import { composeBriefing } from './composer'
import type { TimeOfDay } from './types'

// Opt-in scheduled briefings. Disabled unless the digest node is
// started with DIGEST_SCHEDULED=true in its env. Default off because
// we don't want a fresh install to start firing 7am notifications at
// users who didn't ask for them.
//
// Two daily fires, configurable via env (DIGEST_MORNING_HOUR /
// DIGEST_EVENING_HOUR, both local-time integers 0–23). Defaults: 7am
// and 6pm. We check once a minute against local time; minute precision
// is enough for "morning briefing" — second-level precision would just
// double cost for no perceptible benefit. The minute-tick design keeps
// the implementation a single setInterval with no per-day reschedule
// math (computing "next 7am tomorrow" plus DST handling is the kind of
// premature abstraction CLAUDE.md §14 warns against — wait for the
// third scheduler instance).
//
// Idempotency: once a briefing fires for a given hour-of-day, the
// scheduler suppresses re-fires within the same hour. Restarts inside
// the hour will not re-fire because the suppression key is the local
// "YYYY-MM-DD HH:00" stamp — already-fired stamps stay set in
// process memory only, so a process restart at 07:30 would re-fire
// the 7am briefing. Acceptable for v1; a future PR would persist the
// last-fired stamp under AETHER_DATA_DIR/digest/.

const CHECK_INTERVAL_MS = 60_000

function parseHour(envValue: string | undefined, fallback: number): number {
  if (!envValue) return fallback
  const n = Number.parseInt(envValue, 10)
  if (!Number.isFinite(n) || n < 0 || n > 23) return fallback
  return n
}

export interface SchedulerOptions {
  node: MeshNode
  log: (msg: string) => void
}

export class BriefingScheduler {
  private readonly node: MeshNode
  private readonly log: (msg: string) => void
  private readonly morningHour: number
  private readonly eveningHour: number
  private timer: NodeJS.Timeout | null = null
  private readonly fired = new Set<string>()

  constructor(opts: SchedulerOptions) {
    this.node = opts.node
    this.log = opts.log
    this.morningHour = parseHour(process.env.DIGEST_MORNING_HOUR, 7)
    this.eveningHour = parseHour(process.env.DIGEST_EVENING_HOUR, 18)
  }

  start(): void {
    this.log(
      `scheduler enabled — morning ${this.morningHour}:00, evening ${this.eveningHour}:00 (local time)`,
    )
    this.timer = setInterval(() => {
      void this.tick()
    }, CHECK_INTERVAL_MS)
    // Don't keep the event loop alive solely for the scheduler — the
    // MeshNode SSE stream is the primary keep-alive. (Currently it
    // would stay alive anyway, but unref'ing here is forward-safe.)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async tick(): Promise<void> {
    const now = new Date()
    const hour = now.getHours()
    const minute = now.getMinutes()
    // Only fire at the top of the configured hour (minute < 5 grace so
    // a delayed tick from a busy event loop doesn't miss the window).
    if (minute >= 5) return

    let timeOfDay: TimeOfDay | null = null
    if (hour === this.morningHour) timeOfDay = 'morning'
    else if (hour === this.eveningHour) timeOfDay = 'evening'
    if (!timeOfDay) return

    const stamp = `${now.toISOString().slice(0, 10)} ${hour}:00 ${timeOfDay}`
    if (this.fired.has(stamp)) return
    this.fired.add(stamp)

    try {
      await this.fireAndNotify(timeOfDay)
    } catch (e) {
      this.log(`scheduled ${timeOfDay} briefing failed: ${(e as Error).message}`)
    }
  }

  private async fireAndNotify(timeOfDay: TimeOfDay): Promise<void> {
    this.log(`firing scheduled ${timeOfDay} briefing`)
    const result = await composeBriefing(timeOfDay, { node: this.node })
    // Notification body is the first section's summary — the news lead.
    // Title is constant so the macOS notification grouping stays clean.
    const lead = result.briefing.find((s) => s.available)?.summary ?? 'Briefing ready.'
    const title = `${timeOfDay === 'morning' ? 'Morning' : 'Evening'} Briefing`
    // Notifications cap body at ~1000 chars per host_notifications schema;
    // briefings are typically <300, but truncate defensively so we never
    // hand the upstream a payload it'll reject.
    const body = lead.length > 900 ? `${lead.slice(0, 897)}…` : lead
    try {
      await this.node.invoke('host_notifications.notify', { title, body })
    } catch (e) {
      this.log(`notify upstream failed: ${(e as Error).message}`)
    }
  }
}

export function schedulerEnabled(): boolean {
  return process.env.DIGEST_SCHEDULED === 'true'
}
