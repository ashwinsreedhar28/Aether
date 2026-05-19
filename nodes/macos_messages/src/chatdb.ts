import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Apple Mac Absolute Time epoch: 2001-01-01T00:00:00Z. chat.db's
// date_delivered column stores nanoseconds since that epoch (the older
// pre-Sierra schema used seconds; we target High Sierra+ macOS where
// nanoseconds is the universal form).
const APPLE_EPOCH_OFFSET_SECONDS = 978307200

export const CHAT_DB_PATH: string = join(
  homedir(),
  'Library',
  'Messages',
  'chat.db',
)

export interface ChatRow {
  rowid: number
}

export interface MessageRow {
  chat_id: number
  message_id: number
  text: string | null
  date_delivered: number
  is_from_me: number
  service: string | null
  sender_handle: string | null
  chat_identifier: string | null
  chat_display_name: string | null
}

// Convert Apple Mac Absolute Time (nanoseconds since 2001-01-01) to
// a Unix epoch in milliseconds. Used so messages_recent.date_delivered
// is comparable to captured_at and to ISO 8601 `since` parameters.
export function appleNanosToUnixMs(appleNanos: number): number {
  return Math.round(appleNanos / 1e6 + APPLE_EPOCH_OFFSET_SECONDS * 1000)
}

// Read-only wrapper around the macOS Messages chat.db. Opened with
// `fileMustExist: true` so we surface a clear error if the file is
// missing entirely, and `readonly: true` so we can't corrupt the
// app's database. busy_timeout = 5000ms gives Messages.app room to
// finish its own writes before we error out with SQLITE_BUSY.
export class ChatDb {
  private readonly db: Database.Database

  constructor(path: string = CHAT_DB_PATH) {
    this.db = new Database(path, { readonly: true, fileMustExist: true })
    this.db.pragma('busy_timeout = 5000')
  }

  // List every chat (conversation) in chat.db by ROWID. The poller
  // iterates this list each cycle; chats removed/deleted in the app
  // simply stop showing up here.
  listChats(): ChatRow[] {
    return this.db.prepare('SELECT ROWID AS rowid FROM chat').all() as ChatRow[]
  }

  // Canonical query (pinned in the lane spec). Returns messages
  // strictly newer than the given watermark (Mac Absolute Time
  // nanoseconds), oldest-first so the caller can apply each row's
  // date_delivered as the new watermark without sorting. LIMIT 100
  // caps the per-cycle write amplification for a single chat.
  messagesSince(chatId: number, watermarkNanos: number): MessageRow[] {
    return this.db
      .prepare(
        `
        SELECT
          cmj.chat_id, cmj.message_id, m.text, m.date_delivered,
          m.is_from_me, m.service, h.id AS sender_handle,
          c.chat_identifier, c.display_name AS chat_display_name
        FROM chat_message_join cmj
        JOIN message m ON m.ROWID = cmj.message_id
        LEFT JOIN handle h ON h.ROWID = m.handle_id
        JOIN chat c ON c.ROWID = cmj.chat_id
        WHERE m.date_delivered > ?
          AND m.text IS NOT NULL AND m.text != ''
          AND cmj.chat_id = ?
        ORDER BY m.date_delivered ASC
        LIMIT 100
        `,
      )
      .all(watermarkNanos, chatId) as MessageRow[]
  }

  // Return the most recent message's date_delivered across all chats
  // for a single chat, used during cold-start arming so the watermark
  // starts at "now-ish" rather than zero (which would import the
  // entire history on the next tick).
  latestDeliveredForChat(chatId: number): number {
    const row = this.db
      .prepare(
        `
        SELECT MAX(m.date_delivered) AS d
        FROM chat_message_join cmj
        JOIN message m ON m.ROWID = cmj.message_id
        WHERE cmj.chat_id = ?
        `,
      )
      .get(chatId) as { d: number | null } | undefined
    return row?.d ?? 0
  }

  close(): void {
    this.db.close()
  }
}
