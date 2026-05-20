import { ChatDb, appleNanosToUnixMs, CHAT_DB_PATH } from './chatdb'
import type { InsertArgs, MessagesStore } from './storage'

const POLL_INTERVAL_MS = 30_000

export interface PollerOptions {
  store: MessagesStore
  log: (msg: string) => void
}

export class MessagesPoller {
  private readonly store: MessagesStore
  private readonly log: (msg: string) => void
  private intervalHandle: NodeJS.Timeout | null = null
  private armed = false
  private polling = false
  private permissionWarned = false

  constructor(opts: PollerOptions) {
    this.store = opts.store
    this.log = opts.log
  }

  start(): void {
    if (this.intervalHandle !== null) return
    this.intervalHandle = setInterval(() => {
      void this.tick()
    }, POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
  }

  private async tick(): Promise<void> {
    // Re-entrance guard. A slow chat.db read or a paused process could
    // queue ticks; we drop the new one rather than stacking work.
    if (this.polling) return
    this.polling = true
    let chatDb: ChatDb | null = null
    try {
      chatDb = this.openChatDb()
      if (chatDb === null) return

      const chats = chatDb.listChats()

      // Cold-start: on the very first tick we record the current
      // latest effective_time (MAX(m.date, m.date_delivered)) per chat
      // as the watermark and return, so we don't bulk-import the entire
      // chat history on day one.
      if (!this.armed) {
        for (const c of chats) {
          const latest = chatDb.latestDeliveredForChat(c.rowid)
          this.store.setWatermark(c.rowid, latest)
        }
        this.armed = true
        this.log(`armed with ${chats.length} chat(s); watermarks seeded`)
        return
      }

      let totalInserted = 0
      for (const c of chats) {
        const watermark = this.store.getWatermark(c.rowid)
        const rows = chatDb.messagesSince(c.rowid, watermark)
        if (rows.length === 0) continue

        const capturedAt = Date.now()
        const inserts: InsertArgs[] = rows.map((r) => ({
          chatId: r.chat_id,
          messageId: r.message_id,
          senderHandle: r.sender_handle,
          chatIdentifier: r.chat_identifier,
          chatDisplayName: r.chat_display_name,
          text: r.text,
          // The aether-side messages_recent.date_delivered column holds
          // the effective time (see storage.ts comment). chat.db's raw
          // date_delivered is 0 for self-sent messages, so we use
          // MAX(m.date, m.date_delivered) — already computed by the
          // SELECT — for both watermarking and the stored timestamp.
          dateDelivered: appleNanosToUnixMs(r.effective_time),
          isFromMe: r.is_from_me,
          service: r.service ?? 'unknown',
          capturedAt,
        }))

        // Advance the watermark to the max effective_time (apple-nanos)
        // observed in the batch. We keep watermarks in chat.db's native
        // units so the next `messagesSince` call passes the same form
        // back.
        let maxApple = watermark
        for (const r of rows) if (r.effective_time > maxApple) maxApple = r.effective_time

        const inserted = this.store.insertBatch(c.rowid, inserts, maxApple)
        totalInserted += inserted
      }

      if (totalInserted > 0) {
        this.log(`tick inserted ${totalInserted} new message(s) across ${chats.length} chat(s)`)
      }
    } catch (e) {
      // Treat SQLITE_BUSY (Messages.app holds the lock past our
      // 5s busy_timeout) as a soft skip — retry next cycle. Other
      // errors get logged but don't crash the daemon.
      const err = e as NodeJS.ErrnoException & { code?: string }
      if (err?.code === 'SQLITE_BUSY') {
        this.log('tick skipped: chat.db busy')
      } else {
        this.log(`tick error: ${err.message ?? String(e)}`)
      }
    } finally {
      try {
        chatDb?.close()
      } catch {
        /* best-effort */
      }
      this.polling = false
    }
  }

  // Opens chat.db read-only. Returns null and logs a one-shot warning
  // if Full Disk Access isn't granted (EACCES) or the file simply
  // isn't there yet (ENOENT). The daemon stays up so a user grant
  // takes effect without a restart at the next tick.
  private openChatDb(): ChatDb | null {
    try {
      return new ChatDb()
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { code?: string }
      const code = err?.code ?? ''
      if (code === 'EACCES' || code === 'SQLITE_CANTOPEN' || code === 'ENOENT') {
        if (!this.permissionWarned) {
          this.permissionWarned = true
          this.log(
            `chat.db not readable (${code || 'unknown'}) at ${CHAT_DB_PATH}; ` +
              `grant Full Disk Access to the host process to enable capture. ` +
              `Returning empty results until permission is granted.`,
          )
        }
        return null
      }
      this.log(`chat.db open failed: ${err.message ?? String(e)}`)
      return null
    }
  }
}
