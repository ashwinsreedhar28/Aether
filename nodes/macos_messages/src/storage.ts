import Database from 'better-sqlite3'

export interface MessageEntry {
  id: number
  chatId: number
  messageId: number
  senderHandle: string | null
  chatIdentifier: string | null
  chatDisplayName: string | null
  text: string | null
  dateDelivered: number
  isFromMe: number
  service: string
  capturedAt: number
}

export interface InsertArgs {
  chatId: number
  messageId: number
  senderHandle: string | null
  chatIdentifier: string | null
  chatDisplayName: string | null
  text: string | null
  dateDelivered: number
  isFromMe: number
  service: string
  capturedAt: number
}

export interface RecentQuery {
  limit: number
  since?: string
}

const DB_VERSION = 1

// Thin wrapper around better-sqlite3. Two tables: messages_recent (the
// mirrored rows we expose) and messages_watermarks (per-chat high-water
// mark on chat.db's date_delivered, in Mac Absolute Time).
export class MessagesStore {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages_recent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        sender_handle TEXT,
        chat_identifier TEXT,
        chat_display_name TEXT,
        text TEXT,
        date_delivered INTEGER NOT NULL,
        is_from_me INTEGER NOT NULL,
        service TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        UNIQUE(chat_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_date
        ON messages_recent(date_delivered DESC);
      CREATE TABLE IF NOT EXISTS messages_watermarks (
        chat_id INTEGER PRIMARY KEY,
        last_fetched_at INTEGER NOT NULL
      );
    `)
    this.migrate()
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    let v = row.user_version

    if (v < 1) {
      // v1 is the initial schema, already applied by the CREATE TABLE IF
      // NOT EXISTS block above. Bump user_version so future migrations
      // have a baseline to check against.
      this.db.pragma(`user_version = 1`)
      v = 1
    }

    if (v !== DB_VERSION) {
      throw new Error(
        `macos_messages: DB schema at user_version=${v}, code expects ${DB_VERSION}. Missing migration step.`,
      )
    }
  }

  // Insert a batch of message rows for a single chat inside one
  // transaction, then advance that chat's watermark to the max
  // date_delivered observed in the batch. INSERT OR IGNORE collapses
  // re-reads of the same (chat_id, message_id) pair so a watermark
  // reset can't double-count. Returns the number of rows actually
  // inserted (i.e. genuinely new messages).
  insertBatch(
    chatId: number,
    rows: InsertArgs[],
    watermarkAfter: number,
  ): number {
    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO messages_recent (
        chat_id, message_id, sender_handle, chat_identifier,
        chat_display_name, text, date_delivered, is_from_me,
        service, captured_at
      ) VALUES (
        @chatId, @messageId, @senderHandle, @chatIdentifier,
        @chatDisplayName, @text, @dateDelivered, @isFromMe,
        @service, @capturedAt
      )
    `)
    const watermarkStmt = this.db.prepare(`
      INSERT INTO messages_watermarks (chat_id, last_fetched_at)
      VALUES (?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        last_fetched_at = excluded.last_fetched_at
    `)
    const txn = this.db.transaction((rs: InsertArgs[]) => {
      let inserted = 0
      for (const r of rs) {
        const result = insertStmt.run(r)
        if (result.changes === 1) inserted += 1
      }
      watermarkStmt.run(chatId, watermarkAfter)
      return inserted
    })
    return txn(rows)
  }

  // Seed a watermark without inserting any rows. Used for cold-start
  // arming: the first poll cycle records "where we are now" for each
  // chat so subsequent cycles only pull genuinely new traffic.
  setWatermark(chatId: number, watermark: number): void {
    this.db
      .prepare(
        `
        INSERT INTO messages_watermarks (chat_id, last_fetched_at)
        VALUES (?, ?)
        ON CONFLICT(chat_id) DO UPDATE SET
          last_fetched_at = excluded.last_fetched_at
      `,
      )
      .run(chatId, watermark)
  }

  getWatermark(chatId: number): number {
    const row = this.db
      .prepare('SELECT last_fetched_at AS w FROM messages_watermarks WHERE chat_id = ?')
      .get(chatId) as { w: number } | undefined
    return row?.w ?? 0
  }

  recent(q: RecentQuery): MessageEntry[] {
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
      SELECT id, chat_id AS chatId, message_id AS messageId,
             sender_handle AS senderHandle, chat_identifier AS chatIdentifier,
             chat_display_name AS chatDisplayName, text,
             date_delivered AS dateDelivered, is_from_me AS isFromMe,
             service, captured_at AS capturedAt
      FROM messages_recent
      ${where}
      ORDER BY date_delivered DESC
      LIMIT ?
    `
    positional.push(q.limit)
    return this.db.prepare(sql).all(...positional) as MessageEntry[]
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM messages_recent').get() as {
      n: number
    }
    return row.n
  }

  close(): void {
    this.db.close()
  }
}
