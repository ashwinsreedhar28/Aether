import { randomUUID } from 'node:crypto'
import {
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs'
import { dirname } from 'node:path'

// Append-only, event-sourced ledger for the spawn actor — the shell-side reader
// of the same $AETHER_DATA_DIR/spawns/requests.jsonl the raven request_spawn tool
// appends to (one JSON object per line). It deliberately mirrors the intents gap
// store (nodes/intents/src/storage.ts): low-frequency, append-only, never
// rewritten, fsync'd per append, and trivially inspectable with `cat`.
//
// Pure on purpose — no Electron imports — so the orchestrator (spawnService.ts)
// and the isolated test both consume it. The voice tool writes the *request*
// line (in Python); the shell appends *lifecycle* events here. Both agree on the
// path because both resolve $userData/data (AETHER_DATA_DIR).
//
// Two line families share the log, folded oldest → newest:
//   • a REQUEST line  — { id, ts, draft_path, draft_name, status:'requested' }
//   • a LIFECYCLE event — { id, ts, status:'spawned'|'closed'|'dismissed'|'failed',
//                           worktree?, branch?, step?, error? }
// Discriminator: a line with a string `draft_path` is a request; any other line
// with `id` + `status` is a lifecycle event flipping that request's state. Folding
// forward lets a crash leave a partial log that still reads correctly, and lets
// the human-gated states (requested → spawned → closed, or → dismissed/failed) be
// reconstructed without ever rewriting a line.

export type SpawnStatus = 'requested' | 'spawned' | 'closed' | 'dismissed' | 'failed'

// One spawn's current (folded) state. `ts` is the latest event's time;
// `requestedTs` is the original request's time (for stable newest-first order).
export interface SpawnRecord {
  id: string
  ts: string
  requestedTs: string
  draftName: string
  draftPath: string
  status: SpawnStatus
  // Present once the recipe has launched a worktree (status 'spawned').
  worktree?: string
  branch?: string
  // Present when the recipe failed at a step (status 'failed').
  step?: string
  error?: string
}

// kebab-case slug — MUST match the Python tool's _slugify so the branch/worktree
// the Director sees on the card derive identically (feat/<slug>, ~/aether-<slug>).
export function slugForName(name: string): string {
  const slug = (name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'lane'
}

export class SpawnLedger {
  private readonly path: string

  constructor(path: string) {
    this.path = path
    // Ensure the spawns dir exists so a watcher can attach and the first append
    // never races a missing parent.
    mkdirSync(dirname(path), { recursive: true })
  }

  /**
   * Append a request line. The live flow writes this from the Python tool; this
   * method exists for completeness and for the isolated test, and documents the
   * exact on-disk shape the tool must produce.
   */
  request(draftName: string, draftPath: string): SpawnRecord {
    const rec: SpawnRecord = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      requestedTs: '',
      draftName,
      draftPath,
      status: 'requested',
    }
    rec.requestedTs = rec.ts
    this.append({
      id: rec.id,
      ts: rec.ts,
      draft_path: draftPath,
      draft_name: draftName,
      status: 'requested',
    })
    return rec
  }

  markSpawned(id: string, worktree: string, branch: string): void {
    this.append({ id, ts: new Date().toISOString(), status: 'spawned', worktree, branch })
  }

  markFailed(id: string, step: string, error: string): void {
    this.append({ id, ts: new Date().toISOString(), status: 'failed', step, error })
  }

  markClosed(id: string): void {
    this.append({ id, ts: new Date().toISOString(), status: 'closed' })
  }

  markDismissed(id: string): void {
    this.append({ id, ts: new Date().toISOString(), status: 'dismissed' })
  }

  /** Folded state, newest request first. */
  list(): SpawnRecord[] {
    const byId = this.fold()
    return [...byId.values()].sort((a, b) => b.requestedTs.localeCompare(a.requestedTs))
  }

  find(id: string): SpawnRecord | undefined {
    return this.fold().get(id)
  }

  /** Concurrency=1 gate: true while any record sits in the non-terminal 'spawned'
   * state (a live worktree the Director hasn't marked complete). */
  busy(): boolean {
    for (const rec of this.fold().values()) {
      if (rec.status === 'spawned') return true
    }
    return false
  }

  // Fold the whole log into current-state records, oldest → newest. A malformed
  // line is skipped (a partial write or hand-edit must not blind the log). A
  // lifecycle event for an unknown id seeds a stub so it is never silently lost.
  private fold(): Map<string, SpawnRecord> {
    const byId = new Map<string, SpawnRecord>()
    if (!existsSync(this.path)) return byId

    let raw: string
    try {
      raw = readFileSync(this.path, 'utf8')
    } catch {
      return byId
    }

    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(trimmed) as Record<string, unknown>
      } catch {
        continue /* skip malformed line */
      }
      const id = typeof obj.id === 'string' ? obj.id : null
      if (!id) continue
      const ts = typeof obj.ts === 'string' ? obj.ts : ''

      // Request line — carries the draft identity.
      if (typeof obj.draft_path === 'string') {
        const existing = byId.get(id)
        byId.set(id, {
          id,
          ts,
          requestedTs: ts,
          draftName: typeof obj.draft_name === 'string' ? obj.draft_name : '',
          draftPath: obj.draft_path,
          status: 'requested',
          // Preserve any lifecycle already folded if a request line arrives late.
          ...(existing
            ? {
                ts: existing.ts || ts,
                status: existing.status,
                worktree: existing.worktree,
                branch: existing.branch,
                step: existing.step,
                error: existing.error,
              }
            : {}),
        })
        continue
      }

      // Lifecycle event — flips the status of an existing (or stub) record.
      const status = obj.status
      if (typeof status !== 'string' || !isSpawnStatus(status)) continue
      const existing =
        byId.get(id) ??
        ({
          id,
          ts,
          requestedTs: ts,
          draftName: '',
          draftPath: '',
          status,
        } as SpawnRecord)
      existing.status = status
      existing.ts = ts
      if (typeof obj.worktree === 'string') existing.worktree = obj.worktree
      if (typeof obj.branch === 'string') existing.branch = obj.branch
      if (typeof obj.step === 'string') existing.step = obj.step
      if (typeof obj.error === 'string') existing.error = obj.error
      byId.set(id, existing)
    }

    return byId
  }

  // One append + fsync — the durability path lives in exactly one place, mirroring
  // the intents store. Per-call open/close is fine: spawns fire minutes apart.
  private append(obj: Record<string, unknown>): void {
    const fd = openSync(this.path, 'a')
    try {
      writeSync(fd, JSON.stringify(obj) + '\n')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }
}

function isSpawnStatus(s: string): s is SpawnStatus {
  return (
    s === 'requested' ||
    s === 'spawned' ||
    s === 'closed' ||
    s === 'dismissed' ||
    s === 'failed'
  )
}
