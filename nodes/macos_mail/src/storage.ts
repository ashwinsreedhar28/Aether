import Database from 'better-sqlite3'

export interface MailMessage {
  id: number
  uid: string
  sender: string
  subject: string
  dateReceived: number
  readStatus: number
  capturedAt: number
}

export interface InsertArgs {
  uid: string
  sender: string
  subject: string
  dateReceived: number
  readStatus: number
  capturedAt: number
}

export interface RecentQuery {
  limit: number
  since?: string
}

const DB_VERSION = 1

// Per-node SQLite. WAL keeps reads responsive while the poller writes.
// Single table keyed by Mail.app message UID for dedup; secondary
// index on date_received for the recent() surface.
export class MailStore {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mail_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL UNIQUE,
        sender TEXT NOT NULL,
        subject TEXT NOT NULL,
        date_received INTEGER NOT NULL,
        read_status INTEGER NOT NULL DEFAULT 0,
        captured_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mail_date_received
        ON mail_messages(date_received DESC);
    `)
    this.migrate()
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    let v = row.user_version
    if (v < 1) {
      this.db.pragma(`user_version = 1`)
      v = 1
    }
    if (v !== DB_VERSION) {
      throw new Error(
        `macos_mail: DB schema at user_version=${v}, code expects ${DB_VERSION}. Missing migration step.`,
      )
    }
  }

  // INSERT OR IGNORE keyed on uid. Repeat polls returning the same
  // message are silent no-ops. Returns true if a row was inserted.
  insert(args: InsertArgs): boolean {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO mail_messages
        (uid, sender, subject, date_received, read_status, captured_at)
      VALUES (@uid, @sender, @subject, @dateReceived, @readStatus, @capturedAt)
    `)
    const r = stmt.run(args)
    return r.changes === 1
  }

  // Batch insert as a single transaction. Called by the poller after
  // each successful AppleScript invocation parses N rows.
  insertMany(rows: InsertArgs[]): { inserted: number; skipped: number } {
    if (rows.length === 0) return { inserted: 0, skipped: 0 }
    let inserted = 0
    let skipped = 0
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO mail_messages
        (uid, sender, subject, date_received, read_status, captured_at)
      VALUES (@uid, @sender, @subject, @dateReceived, @readStatus, @capturedAt)
    `)
    const txn = this.db.transaction((batch: InsertArgs[]) => {
      for (const row of batch) {
        const r = stmt.run(row)
        if (r.changes === 1) inserted += 1
        else skipped += 1
      }
    })
    txn(rows)
    return { inserted, skipped }
  }

  recent(q: RecentQuery): MailMessage[] {
    const whereParts: string[] = []
    const positional: unknown[] = []
    if (q.since) {
      const t = Date.parse(q.since)
      if (!Number.isNaN(t)) {
        whereParts.push('date_received >= ?')
        positional.push(t)
      }
    }
    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''
    const sql = `
      SELECT id, uid, sender, subject,
             date_received AS dateReceived,
             read_status AS readStatus,
             captured_at AS capturedAt
      FROM mail_messages
      ${where}
      ORDER BY date_received DESC
      LIMIT ?
    `
    positional.push(q.limit)
    return this.db.prepare(sql).all(...positional) as MailMessage[]
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM mail_messages').get() as {
      n: number
    }
    return row.n
  }

  close(): void {
    this.db.close()
  }
}
