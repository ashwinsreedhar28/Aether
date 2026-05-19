import Database from 'better-sqlite3'

export interface ClipboardEntry {
  id: number
  contentHash: string
  content: string
  contentType: string
  capturedAt: number
}

export interface InsertArgs {
  contentHash: string
  content: string
  contentType: string
  capturedAt: number
}

export interface RecentQuery {
  limit: number
  since?: string
}

const DB_VERSION = 1

// Thin wrapper around better-sqlite3. Single table, single index.
// WAL mode keeps reads responsive while the poller writes.
export class ClipboardStore {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clipboard_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_hash TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'text/plain',
        captured_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_clipboard_captured_at
        ON clipboard_entries(captured_at DESC);
    `)
    this.migrate()
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    let v = row.user_version

    if (v < 1) {
      // v1 is the initial schema, already applied by CREATE TABLE IF
      // NOT EXISTS above. Bump user_version so future migrations have
      // a baseline to check against.
      this.db.pragma(`user_version = 1`)
      v = 1
    }

    if (v !== DB_VERSION) {
      throw new Error(
        `clipboard_history: DB schema at user_version=${v}, code expects ${DB_VERSION}. Missing migration step.`,
      )
    }
  }

  // INSERT OR IGNORE on content_hash: duplicate clipboard contents
  // captured in close succession silently no-op rather than throwing
  // UNIQUE violations. Returns true if a row was actually inserted.
  insert(args: InsertArgs): boolean {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO clipboard_entries
        (content_hash, content, content_type, captured_at)
      VALUES (@contentHash, @content, @contentType, @capturedAt)
    `)
    const r = stmt.run(args)
    return r.changes === 1
  }

  recent(q: RecentQuery): ClipboardEntry[] {
    const whereParts: string[] = []
    const positional: unknown[] = []
    if (q.since) {
      const t = Date.parse(q.since)
      if (!Number.isNaN(t)) {
        whereParts.push('captured_at >= ?')
        positional.push(t)
      }
    }
    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''
    const sql = `
      SELECT id, content_hash AS contentHash, content, content_type AS contentType,
             captured_at AS capturedAt
      FROM clipboard_entries
      ${where}
      ORDER BY captured_at DESC
      LIMIT ?
    `
    positional.push(q.limit)
    return this.db.prepare(sql).all(...positional) as ClipboardEntry[]
  }

  // Retention sweep — keeps only the most recent `keep` rows. Called
  // after each successful insert by the poller. Cheap because of the
  // captured_at DESC index.
  prune(keep: number): void {
    this.db
      .prepare(
        `
      DELETE FROM clipboard_entries
      WHERE id NOT IN (
        SELECT id FROM clipboard_entries
        ORDER BY captured_at DESC
        LIMIT ?
      )
    `,
      )
      .run(keep)
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM clipboard_entries').get() as {
      n: number
    }
    return row.n
  }

  close(): void {
    this.db.close()
  }
}
