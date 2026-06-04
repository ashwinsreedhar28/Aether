import Database from 'better-sqlite3'

export interface MailMessage {
  id: number
  uid: string
  sender: string
  subject: string
  dateReceived: number
  readStatus: number
  capturedAt: number
  // Plain-text body, whitespace-normalized and capped (see poller). null
  // when the body could not be read, or for rows captured before the v2
  // schema (their bodies were never fetched).
  body: string | null
  // 1 when the stored body was truncated (source cap or final cap); 0
  // otherwise. Mirrors readStatus's 0/1 integer convention.
  bodyTruncated: number
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
  unreadOnly?: boolean
}

// A candidate for body backfill: the newest stored rows, in rank order, with
// just enough state for the poller to decide whether to fetch each one.
export interface TopRow {
  uid: string
  body: string | null
  bodyAttempts: number
}

const DB_VERSION = 3

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
      -- Observability key/value. The node has no stdout anyone watches in
      -- the running shell, so poll/capture health is written here and read
      -- with a plain SELECT against the same DB (see setMeta / readMeta).
      CREATE TABLE IF NOT EXISTS mail_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
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
    if (v < 2) {
      // v2 adds body capture. The CREATE TABLE above stays at the v1 column
      // set, so a fresh DB lands here too and gets the columns via ALTER —
      // one code path for both fresh and upgrading databases. Existing rows
      // keep body = NULL (their bodies were never fetched); body_truncated
      // defaults to 0.
      this.db.exec(`
        ALTER TABLE mail_messages ADD COLUMN body TEXT;
        ALTER TABLE mail_messages ADD COLUMN body_truncated INTEGER NOT NULL DEFAULT 0;
      `)
      this.db.pragma(`user_version = 2`)
      v = 2
    }
    if (v < 3) {
      // v3 adds a per-message body-fetch attempt counter. Body capture is a
      // separate, slow AppleScript call per message (see poller.ts); this
      // counter caps retries so a permanently-unreadable top-N message
      // doesn't burn AppleScript time every tick forever.
      this.db.exec(`
        ALTER TABLE mail_messages ADD COLUMN body_attempts INTEGER NOT NULL DEFAULT 0;
      `)
      this.db.pragma(`user_version = 3`)
      v = 3
    }
    if (v !== DB_VERSION) {
      throw new Error(
        `macos_mail: DB schema at user_version=${v}, code expects ${DB_VERSION}. Missing migration step.`,
      )
    }
  }

  // INSERT OR IGNORE keyed on uid. Repeat polls returning the same
  // message are silent no-ops. Returns true if a row was inserted. New rows
  // get body = NULL; bodies are filled separately (see backfillBody).
  insert(args: InsertArgs): boolean {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO mail_messages
        (uid, sender, subject, date_received, read_status, captured_at)
      VALUES (@uid, @sender, @subject, @dateReceived, @readStatus, @capturedAt)
    `)
    const r = stmt.run(args)
    return r.changes === 1
  }

  // Batch insert (headers only) as a single transaction. Called by the
  // poller after each successful header poll parses N rows. Bodies are not
  // captured here — they are fetched separately and filled via backfillBody.
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

  // The newest `n` stored rows, in rank order (newest first), with the state
  // the poller needs to decide which bodies to fetch this tick. Cheap —
  // served from the date_received index.
  topRows(n: number): TopRow[] {
    return this.db
      .prepare(
        `SELECT uid, body, body_attempts AS bodyAttempts
           FROM mail_messages
          ORDER BY date_received DESC
          LIMIT ?`,
      )
      .all(n) as TopRow[]
  }

  // Fill in a message's body, keyed on uid. Guarded on body IS NULL (write
  // once, never churn) and on @body IS NOT NULL (an unreadable re-read never
  // overwrites). On success the attempt counter is reset for hygiene.
  // Returns true if a row was updated.
  backfillBody(uid: string, body: string | null, bodyTruncated: number): boolean {
    const r = this.db
      .prepare(
        `UPDATE mail_messages
            SET body = @body, body_truncated = @bodyTruncated, body_attempts = 0
          WHERE uid = @uid AND body IS NULL AND @body IS NOT NULL`,
      )
      .run({ uid, body, bodyTruncated })
    return r.changes === 1
  }

  // Record a failed or empty body fetch for a still-bodyless message. Once
  // body_attempts reaches MAX_BODY_ATTEMPTS the message is no longer selected
  // by topNeedsBody, so a poisoned slot stops being retried. Guarded on body
  // IS NULL so a message that got its body meanwhile isn't touched.
  bumpBodyAttempt(uid: string): void {
    this.db
      .prepare(
        `UPDATE mail_messages
            SET body_attempts = body_attempts + 1
          WHERE uid = @uid AND body IS NULL`,
      )
      .run({ uid })
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
    if (q.unreadOnly) {
      whereParts.push('read_status = 0')
    }
    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''
    const sql = `
      SELECT id, uid, sender, subject,
             date_received AS dateReceived,
             read_status AS readStatus,
             captured_at AS capturedAt,
             body,
             body_truncated AS bodyTruncated
      FROM mail_messages
      ${where}
      ORDER BY date_received DESC
      LIMIT ?
    `
    positional.push(q.limit)
    return this.db.prepare(sql).all(...positional) as MailMessage[]
  }

  // Observability write. Key/value upsert into mail_meta; the poller records
  // poll/capture health here (last header poll, last body fetch, failure
  // counts, last error) because the node's stdout isn't visible in the
  // running shell. Read with `SELECT * FROM mail_meta` or readMeta().
  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO mail_meta (key, value) VALUES (@key, @value)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run({ key, value })
  }

  readMeta(): Record<string, string> {
    const rows = this.db
      .prepare('SELECT key, value FROM mail_meta')
      .all() as { key: string; value: string }[]
    const out: Record<string, string> = {}
    for (const r of rows) out[r.key] = r.value
    return out
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
