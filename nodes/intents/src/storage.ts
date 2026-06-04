import { randomUUID } from 'node:crypto'
import { openSync, writeSync, fsyncSync, closeSync, readFileSync, existsSync } from 'node:fs'

// A single gap record — one thing Aether could not do. `context` is always
// present in the persisted shape (null when the caller gave none) so every
// consumer reads a stable object.
export interface GapRecord {
  id: string
  ts: string
  text: string
  context: string | null
}

// Append-only JSONL store. One gap per line. This is deliberately NOT a
// database: gaps are low-frequency, append-only, and the whole point of the
// first persistent *mesh-authored* node is to keep the on-disk format
// trivially inspectable (`cat gaps.jsonl`) and trivially durable.
//
// Durability: each append is openSync('a') → writeSync → fsyncSync →
// closeSync. fsync forces the line to stable storage before record() returns,
// so a crash or power loss right after the {ok,id} response cannot lose the
// gap. Per-record open/close is fine — gaps fire on the order of seconds-to-
// minutes apart (a human hitting an unfulfillable request), never in a hot
// loop, so there is no fd-churn cost worth optimising away yet.
export class GapStore {
  private readonly path: string

  constructor(path: string) {
    this.path = path
  }

  // Append a new gap and fsync before returning. Generates the id + ts here
  // so the persisted record is the single source of truth (the handler never
  // mints an id the disk doesn't have).
  record(text: string, context: string | null): GapRecord {
    const rec: GapRecord = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      text,
      context,
    }
    const line = JSON.stringify(rec) + '\n'
    const fd = openSync(this.path, 'a')
    try {
      writeSync(fd, line)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    return rec
  }

  // Newest-first read. The file is append-order (oldest → newest), so we walk
  // it bottom-up and stop once `limit` valid records are collected. A
  // malformed line (partial write that somehow escaped fsync, manual edit) is
  // skipped rather than throwing — one bad line must not blind the whole log.
  list(limit: number): GapRecord[] {
    if (!existsSync(this.path)) return []
    const raw = readFileSync(this.path, 'utf8')
    const lines = raw.split('\n')
    const out: GapRecord[] = []
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      const line = lines[i]
      if (line === undefined || line.trim().length === 0) continue
      try {
        const obj = JSON.parse(line) as Partial<GapRecord>
        if (typeof obj.id === 'string' && typeof obj.text === 'string') {
          out.push({
            id: obj.id,
            ts: typeof obj.ts === 'string' ? obj.ts : '',
            text: obj.text,
            context: typeof obj.context === 'string' ? obj.context : null,
          })
        }
      } catch {
        /* skip malformed line */
      }
    }
    return out
  }
}
