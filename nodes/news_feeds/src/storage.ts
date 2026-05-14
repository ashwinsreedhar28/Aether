import Database from 'better-sqlite3'
import type { Article } from './parser'

export interface RecentQuery {
  limit: number
  since?: string
}

// Thin wrapper around better-sqlite3. Writes are synchronous (sqlite is a
// process-local file), batched in a single transaction per poll. Reads
// (recent surface) are sub-millisecond for tens of thousands of rows given
// the index on published_at.
export class ArticleStore {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    // WAL keeps the recent-read responsive even while a poll is upserting.
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY,
        feed TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        url TEXT NOT NULL,
        published_at TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_articles_published_at
        ON articles(published_at);
    `)
  }

  upsertMany(articles: Article[]): { inserted: number; updated: number } {
    if (articles.length === 0) return { inserted: 0, updated: 0 }
    // ON CONFLICT(id): a re-fetch of the same article (stable id from
    // feed+guid) refreshes the summary/title/fetched_at but does NOT
    // change published_at — feeds occasionally re-emit older posts with
    // a fresh pubDate, which would shuffle them to the top spuriously.
    const stmt = this.db.prepare(`
      INSERT INTO articles (id, feed, title, summary, url, published_at, fetched_at)
      VALUES (@id, @feed, @title, @summary, @url, @published_at, @fetched_at)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        url = excluded.url,
        fetched_at = excluded.fetched_at
    `)
    let inserted = 0
    let updated = 0
    const txn = this.db.transaction((rows: Article[]) => {
      for (const row of rows) {
        const r = stmt.run(row)
        if (r.changes === 1) inserted += 1
        else if (r.changes === 2) updated += 1
        // r.changes === 0 happens when nothing actually changed.
      }
    })
    txn(articles)
    return { inserted, updated }
  }

  recent(q: RecentQuery): Article[] {
    if (q.since) {
      const stmt = this.db.prepare(`
        SELECT id, feed, title, summary, url, published_at, fetched_at
        FROM articles
        WHERE published_at >= @since
        ORDER BY published_at DESC
        LIMIT @limit
      `)
      return stmt.all({ since: q.since, limit: q.limit }) as Article[]
    }
    const stmt = this.db.prepare(`
      SELECT id, feed, title, summary, url, published_at, fetched_at
      FROM articles
      ORDER BY published_at DESC
      LIMIT @limit
    `)
    return stmt.all({ limit: q.limit }) as Article[]
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM articles').get() as { n: number }
    return row.n
  }

  close(): void {
    this.db.close()
  }
}
