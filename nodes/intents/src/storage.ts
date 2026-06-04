import { randomUUID } from 'node:crypto'
import { openSync, writeSync, fsyncSync, closeSync, readFileSync, existsSync } from 'node:fs'

// A gap has a lifecycle: it is recorded **open** and later marked **closed**
// once the capability it noted exists. `status` is part of the in-memory shape
// every consumer reads; `context` is always present (null when none given).
export type GapStatus = 'open' | 'closed'

// A single gap record — one thing Aether could not do. The persisted form on
// the OPEN line carries `status: 'open'` (self-describing); a record is moved to
// 'closed' by a separate closure event, never by rewriting the line.
export interface GapRecord {
  id: string
  ts: string
  text: string
  context: string | null
  status: GapStatus
}

// Always-full-log tallies, independent of the status filter / limit applied to a
// given list() call — so a consumer showing only open gaps can still print the
// closed count in a header ("2 open · 3 closed").
export interface GapCounts {
  open: number
  closed: number
}

// Result of a list() read: the (filtered, limited) gaps plus whole-log counts.
export interface GapListResult {
  gaps: GapRecord[]
  counts: GapCounts
}

// Append-only JSONL store with an **event-sourced lifecycle**. One event per
// line. This is deliberately NOT a database: gaps are low-frequency,
// append-only, and the whole point of the first persistent *mesh-authored* node
// is to keep the on-disk format trivially inspectable (`cat gaps.jsonl`) and
// trivially durable.
//
// Two line shapes share the log:
//   • a GAP line     — { id, ts, text, context, status:'open' } — records a gap.
//   • a CLOSURE event — { id, ts, closed:true } — marks an existing gap closed.
// Discriminator: a line with `closed === true` is a closure event; a line with
// string `id` + string `text` is a gap. Current state is derived by folding the
// log forward (oldest → newest): the gap line creates the record, a later
// closure event flips its status. This keeps the lifecycle JSONL-honest — the
// store NEVER rewrites or truncates the file, so the same append+fsync
// durability that protects a recorded gap also protects a closure.
//
// Durability: each append is openSync('a') → writeSync → fsyncSync →
// closeSync. fsync forces the bytes to stable storage before the call returns,
// so a crash or power loss right after the response cannot lose the event.
// Per-call open/close is fine — gaps and closures fire seconds-to-minutes apart
// (a human acting), never in a hot loop, so there is no fd-churn cost worth
// optimising away yet.
export class GapStore {
  private readonly path: string

  constructor(path: string) {
    this.path = path
  }

  // Append a new OPEN gap and fsync before returning. Generates id + ts here so
  // the persisted record is the single source of truth (the handler never mints
  // an id the disk doesn't have).
  record(text: string, context: string | null): GapRecord {
    const rec: GapRecord = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      text,
      context,
      status: 'open',
    }
    this.append(JSON.stringify(rec) + '\n')
    return rec
  }

  // Mark gap(s) closed by appending a closure event per newly-closed id, fsync'd
  // once. Selector (exactly one is expected; `id` wins if both are passed):
  //   • id    — close that one gap, if it exists and is currently open.
  //   • match — close every OPEN gap whose `text` contains the (case-insensitive)
  //             substring. This is what lets "the email one is done" close both
  //             mail gaps in one call.
  // Already-closed gaps and a no-match request are no-ops (returns []). Returns
  // the records as they now stand (status:'closed').
  close(opts: { id?: string; match?: string }): { closed: GapRecord[] } {
    const open = this.readAll().filter((r) => r.status === 'open')

    let targets: GapRecord[]
    if (opts.id) {
      const rec = open.find((r) => r.id === opts.id)
      targets = rec ? [rec] : []
    } else if (opts.match) {
      const needle = opts.match.toLowerCase()
      targets = open.filter((r) => r.text.toLowerCase().includes(needle))
    } else {
      targets = []
    }

    if (targets.length === 0) return { closed: [] }

    const now = new Date().toISOString()
    const lines = targets
      .map((r) => JSON.stringify({ id: r.id, ts: now, closed: true }) + '\n')
      .join('')
    this.append(lines)

    return { closed: targets.map((r) => ({ ...r, status: 'closed' as GapStatus })) }
  }

  // Newest-first read with whole-log counts. `status` filters the returned gaps
  // ('open' | 'closed' | 'all'); `counts` always reflects the entire log so a
  // header can show both tallies regardless of the filter. `limit` caps the
  // returned (filtered) gaps only — counts are uncapped.
  list(opts: { limit: number; status: GapStatus | 'all' }): GapListResult {
    const all = this.readAll()
    const counts: GapCounts = { open: 0, closed: 0 }
    for (const r of all) {
      if (r.status === 'closed') counts.closed += 1
      else counts.open += 1
    }
    const newestFirst = [...all].reverse()
    const filtered =
      opts.status === 'all' ? newestFirst : newestFirst.filter((r) => r.status === opts.status)
    return { gaps: filtered.slice(0, opts.limit), counts }
  }

  // Fold the whole log into current-state records, in creation order
  // (oldest → newest). A malformed line (partial write that escaped fsync, a
  // hand-edit) is skipped rather than throwing — one bad line must not blind the
  // whole log. A closure event for an unknown id is harmless (no record to flip).
  private readAll(): GapRecord[] {
    if (!existsSync(this.path)) return []
    const raw = readFileSync(this.path, 'utf8')
    const lines = raw.split('\n')
    const order: string[] = []
    const byId = new Map<string, GapRecord>()
    const closedIds = new Set<string>()

    for (const line of lines) {
      if (line === undefined || line.trim().length === 0) continue
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue /* skip malformed line */
      }
      // Closure event — flips an existing gap closed on fold. Recorded
      // separately so it applies even if (defensively) it precedes its gap line.
      if (obj.closed === true && typeof obj.id === 'string') {
        closedIds.add(obj.id)
        continue
      }
      // Gap line. Migrate legacy lines that predate the lifecycle field: an
      // absent/invalid `status` reads as 'open'.
      if (typeof obj.id === 'string' && typeof obj.text === 'string') {
        if (!byId.has(obj.id)) order.push(obj.id)
        byId.set(obj.id, {
          id: obj.id,
          ts: typeof obj.ts === 'string' ? obj.ts : '',
          text: obj.text,
          context: typeof obj.context === 'string' ? obj.context : null,
          status: obj.status === 'closed' ? 'closed' : 'open',
        })
      }
    }

    for (const id of closedIds) {
      const rec = byId.get(id)
      if (rec) rec.status = 'closed'
    }

    return order.map((id) => byId.get(id) as GapRecord)
  }

  // One append + fsync. Shared by record() and close() so the durability path
  // lives in exactly one place.
  private append(data: string): void {
    const fd = openSync(this.path, 'a')
    try {
      writeSync(fd, data)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }
}
