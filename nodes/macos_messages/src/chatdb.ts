import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Apple Mac Absolute Time epoch: 2001-01-01T00:00:00Z. chat.db's
// message.date and message.date_delivered columns both store
// nanoseconds since that epoch (the older pre-Sierra schema used
// seconds; we target High Sierra+ macOS where nanoseconds is the
// universal form).
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
  // Effective message time as Mac Absolute Time nanoseconds:
  // MAX(message.date, message.date_delivered). chat.db's raw
  // date_delivered is 0 for messages sent from this Mac (Apple only
  // populates the field on inbound APNS delivery), so the raw value
  // can't be used for ordering or watermarking.
  effective_time: number
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
  // effective_time as the new watermark without sorting. LIMIT 100
  // caps the per-cycle write amplification for a single chat.
  //
  // Effective time = MAX(m.date, m.date_delivered) — SQLite's 2-arg
  // scalar MAX, not the aggregate. chat.db's raw date_delivered is 0
  // for messages sent from this Mac (Apple only populates the field on
  // inbound APNS delivery), so the raw value misses every self-sent
  // message. Using the scalar max lets self-sent rows cross the
  // watermark via m.date while inbound rows continue to use the (newer)
  // m.date_delivered, preserving prior ordering for received messages.
  messagesSince(chatId: number, watermarkNanos: number): MessageRow[] {
    return this.db
      .prepare(
        `
        SELECT
          cmj.chat_id, cmj.message_id, m.text,
          MAX(m.date, m.date_delivered) AS effective_time,
          m.is_from_me, m.service, h.id AS sender_handle,
          c.chat_identifier, c.display_name AS chat_display_name
        FROM chat_message_join cmj
        JOIN message m ON m.ROWID = cmj.message_id
        LEFT JOIN handle h ON h.ROWID = m.handle_id
        JOIN chat c ON c.ROWID = cmj.chat_id
        WHERE MAX(m.date, m.date_delivered) > ?
          AND m.text IS NOT NULL AND m.text != ''
          AND cmj.chat_id = ?
        ORDER BY MAX(m.date, m.date_delivered) ASC
        LIMIT 100
        `,
      )
      .all(watermarkNanos, chatId) as MessageRow[]
  }

  // Return the most recent effective_time (MAX(m.date, m.date_delivered))
  // across all messages in a single chat, used during cold-start arming
  // so the watermark starts at "now-ish" rather than zero (which would
  // import the entire history on the next tick). Expression matches
  // `messagesSince` exactly — if these drift, fresh installs over a
  // chat.db with history will mis-seed and either over- or under-fetch
  // on the first cycle. The outer MAX(...) is the aggregate; the inner
  // MAX(m.date, m.date_delivered) is the scalar 2-arg form.
  latestDeliveredForChat(chatId: number): number {
    const row = this.db
      .prepare(
        `
        SELECT MAX(MAX(m.date, m.date_delivered)) AS d
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
