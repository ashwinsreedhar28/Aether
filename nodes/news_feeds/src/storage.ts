import Database from 'better-sqlite3'
import type { Article } from './parser'
import type { Category } from './types'

export interface RecentQuery {
  limit: number
  since?: string
  /** If present and non-empty, only articles whose category is in the
   * list are returned. The handler normalises single-string callers to
   * a one-element array before reaching this layer. */
  categories?: Category[]
}

export interface SearchQuery {
  /** FTS5 MATCH string. The handler is responsible for sanitising
   * user input into a syntactically valid FTS5 query — see
   * sanitiseFtsQuery() below. */
  match: string
  limit: number
  /** Same shape as RecentQuery.categories: undefined / empty = no
   * filter; otherwise restrict to articles whose category is in the
   * list. */
  categories?: Category[]
}

// Bump this when the schema changes. The constructor checks PRAGMA
// user_version against this constant and applies forward-only migrations
// when stored < current. No down-migration; we never need to roll a
// node-local DB back to an older schema in this codebase.
const DB_VERSION = 2

// Thin wrapper around better-sqlite3. Writes are synchronous (sqlite is a
// process-local file), batched in a single transaction per poll. Reads
// (recent surface) are sub-millisecond for tens of thousands of rows given
// the indexes on published_at and (category, published_at).
export class ArticleStore {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    // WAL keeps the recent-read responsive even while a poll is upserting.
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    // Fresh-install schema: applied verbatim when the DB is empty. The
    // category column is part of the table from v1 onward; migrations
    // below patch older DBs that pre-date the column. Column-dependent
    // indexes and the FTS5 virtual table are created in migrate() only
    // — adding them here would race a pre-migration DB (CLAUDE.md §10
    // schema-migrations gotcha: column-dependent objects must live in
    // the migration step, not the initial CREATE block).
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY,
        feed TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'world',
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        url TEXT NOT NULL,
        published_at TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_articles_published_at
        ON articles(published_at);
    `)
    this.migrate()
  }

  // Forward-only migrations. Each step checks PRAGMA user_version and
  // bumps it after applying its changes inside a transaction. Existing
  // rows from pre-category installs get the 'world' default until the
  // next poll re-categorises them via the UPSERT in upsertMany (which
  // updates the category column on conflict).
  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    let v = row.user_version

    if (v < 1) {
      const cols = this.db.prepare("PRAGMA table_info('articles')").all() as Array<{
        name: string
      }>
      const hasCategory = cols.some((c) => c.name === 'category')
      const apply = this.db.transaction(() => {
        if (!hasCategory) {
          // ALTER TABLE backfills every existing row with 'world'. This
          // is a one-time inaccuracy: within 15 min of the next poll,
          // those rows UPSERT against their feed's actual category.
          this.db.exec("ALTER TABLE articles ADD COLUMN category TEXT NOT NULL DEFAULT 'world'")
        }
        // Index is idempotent under IF NOT EXISTS but harmless to retry.
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_articles_category_published_at
            ON articles(category, published_at DESC)
        `)
        this.db.pragma(`user_version = 1`)
      })
      apply()
      v = 1
    }

    if (v < 2) {
      // FTS5 keyword search. `content='articles', content_rowid='rowid'`
      // makes articles_fts an external-content table — column data
      // isn't duplicated, FTS5 reads source rows back from `articles`
      // by rowid when it needs to. That contract requires the FTS5
      // column names to MATCH the column names in `articles` (FTS5
      // emits `SELECT col FROM articles WHERE rowid=?` against them
      // during integrity / rebuild paths). So the FTS5 columns are
      // named `title`, `summary`, `feed` — same as the articles
      // table. The voice tool / schema rename `feed` to `source` on
      // the way out for the spoken response; internally we keep names
      // aligned. Naming them differently here (e.g. `source` on the
      // FTS5 side, `feed` on the articles side) silently passes search
      // queries but breaks `SELECT * FROM articles_fts` and any
      // FTS5-internal rebuild — a foot-gun we're not introducing.
      //
      // Tokenizer: porter for stem-matching ("wildfire" → "wildfires",
      // "report" → "reporting"). It does NOT stem aggressively across
      // word families ("iran" ≠ "iranian"); accepted porter limit —
      // anything fancier is the semantic-search world we're explicitly
      // deferring (see DECISIONS.md 2026-05-13).
      //
      // The three sync triggers keep articles_fts in lockstep with
      // articles. AFTER DELETE / UPDATE use the FTS5 'delete' command
      // form (per sqlite docs §4.4.3 for external-content tables) so
      // stale rows leave the index cleanly.
      const apply = this.db.transaction(() => {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
            title,
            summary,
            feed,
            content='articles',
            content_rowid='rowid',
            tokenize='porter'
          );

          CREATE TRIGGER IF NOT EXISTS articles_ai
          AFTER INSERT ON articles BEGIN
            INSERT INTO articles_fts(rowid, title, summary, feed)
            VALUES (new.rowid, new.title, new.summary, new.feed);
          END;

          CREATE TRIGGER IF NOT EXISTS articles_ad
          AFTER DELETE ON articles BEGIN
            INSERT INTO articles_fts(articles_fts, rowid, title, summary, feed)
            VALUES('delete', old.rowid, old.title, old.summary, old.feed);
          END;

          CREATE TRIGGER IF NOT EXISTS articles_au
          AFTER UPDATE ON articles BEGIN
            INSERT INTO articles_fts(articles_fts, rowid, title, summary, feed)
            VALUES('delete', old.rowid, old.title, old.summary, old.feed);
            INSERT INTO articles_fts(rowid, title, summary, feed)
            VALUES (new.rowid, new.title, new.summary, new.feed);
          END;
        `)

        // Backfill from existing articles. Safe on a fresh install too
        // — selecting from an empty table yields no rows. Using
        // INSERT INTO articles_fts(rowid, ...) SELECT ... is the
        // documented bulk-load form for external-content FTS5 tables.
        this.db.exec(`
          INSERT INTO articles_fts(rowid, title, summary, feed)
          SELECT rowid, title, summary, feed FROM articles;
        `)

        this.db.pragma(`user_version = 2`)
      })
      apply()
      v = 2
    }

    if (v !== DB_VERSION) {
      // Defensive: if a future bump lands and someone forgets to add a
      // step, fail loud rather than silently running with an out-of-date
      // schema. The node will exit on this and Core's supervisor will
      // surface the error.
      throw new Error(
        `news_feeds: DB schema at user_version=${v}, code expects ${DB_VERSION}. Missing migration step.`,
      )
    }
  }

  upsertMany(articles: Article[]): { inserted: number; updated: number } {
    if (articles.length === 0) return { inserted: 0, updated: 0 }
    // ON CONFLICT(id): a re-fetch of the same article (stable id from
    // feed+guid) refreshes the summary/title/category/fetched_at but
    // does NOT change published_at — feeds occasionally re-emit older
    // posts with a fresh pubDate, which would shuffle them to the top
    // spuriously. Category IS overwritten so a feed re-categorised in
    // feeds.ts (or a pre-migration 'world' default row) gets corrected
    // on the next poll.
    const stmt = this.db.prepare(`
      INSERT INTO articles (id, feed, category, title, summary, url, published_at, fetched_at)
      VALUES (@id, @feed, @category, @title, @summary, @url, @published_at, @fetched_at)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        url = excluded.url,
        category = excluded.category,
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
    // Build the WHERE clause dynamically. Category and since are
    // independently optional. better-sqlite3 doesn't natively parameterise
    // IN (?, ?, ?) lists, so we splice placeholders inline — values still
    // bind via positional parameters, so there's no injection surface.
    const whereParts: string[] = []
    const positional: unknown[] = []
    if (q.since) {
      whereParts.push('published_at >= ?')
      positional.push(q.since)
    }
    if (q.categories && q.categories.length > 0) {
      const placeholders = q.categories.map(() => '?').join(', ')
      whereParts.push(`category IN (${placeholders})`)
      positional.push(...q.categories)
    }
    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''
    const sql = `
      SELECT id, feed, category, title, summary, url, published_at, fetched_at
      FROM articles
      ${where}
      ORDER BY published_at DESC
      LIMIT ?
    `
    positional.push(q.limit)
    return this.db.prepare(sql).all(...positional) as Article[]
  }

  // FTS5 keyword search. Ranks by bm25 (FTS5's `rank` column, which is
  // already negative-better-is-larger for ORDER BY), with published_at
  // as a tiebreaker so two equally-relevant hits land newest-first.
  // Category filter is applied as a regular WHERE on the joined
  // articles row — FTS5 itself doesn't know about category.
  search(q: SearchQuery): Article[] {
    const whereParts: string[] = ['articles_fts MATCH ?']
    const positional: unknown[] = [q.match]
    if (q.categories && q.categories.length > 0) {
      const placeholders = q.categories.map(() => '?').join(', ')
      whereParts.push(`a.category IN (${placeholders})`)
      positional.push(...q.categories)
    }
    const sql = `
      SELECT a.id, a.feed, a.category, a.title, a.summary, a.url,
             a.published_at, a.fetched_at
      FROM articles_fts
      JOIN articles a ON a.rowid = articles_fts.rowid
      WHERE ${whereParts.join(' AND ')}
      ORDER BY articles_fts.rank, a.published_at DESC
      LIMIT ?
    `
    positional.push(q.limit)
    return this.db.prepare(sql).all(...positional) as Article[]
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM articles').get() as { n: number }
    return row.n
  }

  close(): void {
    this.db.close()
  }
}
