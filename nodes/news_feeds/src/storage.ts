import Database from 'better-sqlite3'
import type { Article } from './parser'
import type { Category, Entity, EntityKind, Urgency } from './types'

export interface RecentQuery {
  limit: number
  since?: string
  /** If present and non-empty, only articles whose category is in the
   * list are returned. The handler normalises single-string callers to
   * a one-element array before reaching this layer. */
  categories?: Category[]
  /** If present and non-empty, only articles whose urgency bucket is
   * in the list are returned. Same one-element-array normalisation as
   * categories. AND-combines with categories — e.g. tech + high
   * narrows to tech articles that also scored into the high bucket. */
  urgencies?: Urgency[]
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
  /** Same shape as RecentQuery.urgencies; AND-combines with categories
   * and the FTS5 match clause. */
  urgencies?: Urgency[]
}

export interface BreakingQuery {
  limit: number
}

export interface EntitySearchQuery {
  /** Surface name of the entity. Compared case-insensitively against
   * `article_entities.entity_name` via LOWER() on both sides — entities
   * are stored case-preserved so the display form is retained. */
  entity: string
  /** Optional entity-kind filter. Omit to match across persons, places,
   * and organizations. */
  kind?: EntityKind
  limit: number
}

// Bump this when the schema changes. The constructor checks PRAGMA
// user_version against this constant and applies forward-only migrations
// when stored < current. No down-migration; we never need to roll a
// node-local DB back to an older schema in this codebase.
const DB_VERSION = 5

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

    if (v < 3) {
      // v3 — urgency scoring. New column on `articles`, compound index
      // on (urgency, published_at DESC) for the breaking() / urgency-
      // filtered recent() paths. CLAUDE.md §10 schema-migrations gotcha
      // again: ALTER + CREATE INDEX both live inside this migrate()
      // step, not the initial CREATE block — the index references a
      // column that doesn't exist on a pre-migration DB.
      //
      // Default 'low' for pre-existing rows is a one-time inaccuracy:
      // within 15 min of the next poll, each row UPSERTs against its
      // freshly-computed urgency (the ON CONFLICT clause in upsertMany
      // overwrites urgency the same way it overwrites category). Rows
      // for feeds that have stopped emitting will remain 'low' until
      // they're either re-emitted or pruned by a future retention pass.
      const cols = this.db.prepare("PRAGMA table_info('articles')").all() as Array<{
        name: string
      }>
      const hasUrgency = cols.some((c) => c.name === 'urgency')
      const apply = this.db.transaction(() => {
        if (!hasUrgency) {
          this.db.exec("ALTER TABLE articles ADD COLUMN urgency TEXT NOT NULL DEFAULT 'low'")
        }
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_articles_urgency_published_at
            ON articles(urgency, published_at DESC)
        `)
        this.db.pragma(`user_version = 3`)
      })
      apply()
      v = 3
    }

    if (v < 4) {
      // Entity dimension. article_entities holds (article_id,
      // entity_name, entity_kind, mentions) — one row per (article,
      // canonical-name) pair. The PRIMARY KEY (article_id, entity_name)
      // means within a single article a name can carry only one kind;
      // the extractor collapses cross-kind duplicates accordingly. See
      // DECISIONS.md 2026-05-13 "News entity extraction via compromise"
      // for the rationale and trade-offs.
      //
      // article_id is TEXT — matching `articles.id` which is the
      // sha1-hex stable id from parser.ts, not an integer rowid. ON
      // DELETE CASCADE so a future article-purge / retention sweep
      // doesn't strand orphan entity rows. We don't enable
      // foreign_keys PRAGMA on this DB today (cost is per-write and the
      // articles table never deletes), so the FK serves as
      // documentation + future safety net rather than enforced
      // constraint. Acceptable v1.
      //
      // The index covers the search_by_entity hot path: WHERE
      // entity_name = ? AND entity_kind = ?  — note the WHERE uses
      // LOWER() on both sides for case-insensitive match, which
      // disables this index for the canonical lookup. Index is
      // retained anyway as a hint for future expression-index work
      // (CREATE INDEX ... ON article_entities(LOWER(entity_name))) and
      // for any future exact-case query path.
      //
      // CLAUDE.md §10 schema-migrations gotcha applies: this CREATE
      // TABLE + CREATE INDEX live inside the migration step, NOT the
      // initial CREATE block at the top of the constructor — adding
      // them there would race a pre-v4 DB whose `article_entities`
      // table doesn't yet exist on first open.
      //
      // Orthogonal to the v2→v3 urgency column above: article_entities
      // joins articles on `id` (TEXT sha1-hex), not on `urgency`. The
      // urgency column being present is unrelated to entity storage; we
      // don't read or write it in this step.
      const apply = this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS article_entities (
            article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
            entity_name TEXT NOT NULL,
            entity_kind TEXT NOT NULL CHECK (entity_kind IN ('person','place','organization')),
            mentions INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (article_id, entity_name)
          );

          CREATE INDEX IF NOT EXISTS idx_article_entities_name_id
            ON article_entities(entity_name, article_id DESC);
        `)
        this.db.pragma(`user_version = 4`)
      })
      apply()
      v = 4
      // Existing articles get zero entities at migration time. They
      // pick up entities lazily on next poll (UPSERT into articles
      // triggers re-extraction in the poller); a populated v0.3.x DB
      // backfilled this way takes one full poll cycle (15min default)
      // to gain entity coverage. Backfilling the existing rows here
      // would parse hundreds of summaries inside the migration
      // transaction, blocking the node from coming online — deferred
      // to a follow-up if observed empty-result rate is too high.
    }

    if (v < 5) {
      // v5 — urgency_reason column. Persists which scoring signals
      // contributed most to each article's urgency bucket so voice
      // responses can speak the *why* of urgency without re-running
      // the scorer at read time. Computed by scorer.ts buildReason()
      // at fetch time, propagated through parser.ts onto the Article
      // shape, and overwritten on each UPSERT alongside urgency.
      //
      // Default 'pre-amendment' for pre-existing rows is a one-time
      // inaccuracy that resolves on the next poll: the ON CONFLICT
      // clause in upsertMany overwrites urgency_reason the same way
      // it overwrites urgency. Within 15 min of next poll, every
      // still-emitted article gets a real reason. Rows for feeds that
      // have stopped emitting will keep 'pre-amendment' until they're
      // re-emitted or pruned. CLAUDE.md §10 schema-migrations gotcha
      // doesn't bite here — urgency_reason has no column-dependent
      // index, so the ALTER TABLE can stand alone in this step.
      const cols = this.db.prepare("PRAGMA table_info('articles')").all() as Array<{
        name: string
      }>
      const hasReason = cols.some((c) => c.name === 'urgency_reason')
      const apply = this.db.transaction(() => {
        if (!hasReason) {
          this.db.exec(
            "ALTER TABLE articles ADD COLUMN urgency_reason TEXT NOT NULL DEFAULT 'pre-amendment'",
          )
        }
        this.db.pragma(`user_version = 5`)
      })
      apply()
      v = 5
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
    // feed+guid) refreshes the summary/title/category/urgency/fetched_at
    // but does NOT change published_at — feeds occasionally re-emit
    // older posts with a fresh pubDate, which would shuffle them to the
    // top spuriously. Category IS overwritten so a feed re-categorised
    // in feeds.ts (or a pre-migration 'world' default row) gets
    // corrected on the next poll. Urgency is overwritten too: scoring
    // is recomputed per fetch, so an article that crossed the medium /
    // high threshold since the last poll (recency component cooling)
    // gets the new bucket — pre-migration rows on the 'low' default
    // are re-scored within 15 min of next poll.
    const stmt = this.db.prepare(`
      INSERT INTO articles (id, feed, category, urgency, urgency_reason, title, summary, url, published_at, fetched_at)
      VALUES (@id, @feed, @category, @urgency, @urgency_reason, @title, @summary, @url, @published_at, @fetched_at)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        url = excluded.url,
        category = excluded.category,
        urgency = excluded.urgency,
        urgency_reason = excluded.urgency_reason,
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
    // Build the WHERE clause dynamically. Category, urgency, and since
    // are independently optional. better-sqlite3 doesn't natively
    // parameterise IN (?, ?, ?) lists, so we splice placeholders inline
    // — values still bind via positional parameters, so there's no
    // injection surface.
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
    if (q.urgencies && q.urgencies.length > 0) {
      const placeholders = q.urgencies.map(() => '?').join(', ')
      whereParts.push(`urgency IN (${placeholders})`)
      positional.push(...q.urgencies)
    }
    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''
    const sql = `
      SELECT id, feed, category, urgency, urgency_reason, title, summary, url, published_at, fetched_at
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
    if (q.urgencies && q.urgencies.length > 0) {
      const placeholders = q.urgencies.map(() => '?').join(', ')
      whereParts.push(`a.urgency IN (${placeholders})`)
      positional.push(...q.urgencies)
    }
    const sql = `
      SELECT a.id, a.feed, a.category, a.urgency, a.urgency_reason, a.title, a.summary, a.url,
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

  // Convenience read for "what's breaking" — equivalent to recent() with
  // urgencies=['high'] but named explicitly because the voice tool and
  // the prompts surface it as a distinct capability. Sorted newest-first
  // among the high bucket, capped at `limit`. Uses the
  // (urgency, published_at DESC) compound index added in the v3
  // migration; reads stay sub-ms on the curated pool size.
  breaking(q: BreakingQuery): Article[] {
    const sql = `
      SELECT id, feed, category, urgency, urgency_reason, title, summary, url, published_at, fetched_at
      FROM articles
      WHERE urgency = 'high'
      ORDER BY published_at DESC
      LIMIT ?
    `
    return this.db.prepare(sql).all(q.limit) as Article[]
  }

  // Replace the entity set for one article. Atomic delete-then-insert
  // inside a single transaction so a concurrent search_by_entity never
  // sees a partial state. Called by the poller after each upsertMany —
  // re-extracting on every poll is idempotent (extractor is pure) and
  // ensures a re-categorised or re-titled article's entity set stays
  // in sync.
  replaceArticleEntities(articleId: string, entities: Entity[]): void {
    const del = this.db.prepare('DELETE FROM article_entities WHERE article_id = ?')
    const ins = this.db.prepare(`
      INSERT INTO article_entities (article_id, entity_name, entity_kind, mentions)
      VALUES (?, ?, ?, ?)
    `)
    const txn = this.db.transaction((rows: Entity[]) => {
      del.run(articleId)
      for (const e of rows) {
        ins.run(articleId, e.name, e.kind, e.mentions)
      }
    })
    txn(entities)
  }

  // Entity-aware search. Case-insensitive name match (LOWER both
  // sides) with an optional kind filter. Sorted by mentions DESC then
  // published_at DESC so articles that mention the entity more
  // centrally bubble above passing references; ties land newest-first.
  // Returns Article rows (same shape as recent / search / breaking) so
  // the surface payload stays uniform across the four read paths.
  searchByEntity(q: EntitySearchQuery): Article[] {
    const whereParts: string[] = ['LOWER(ae.entity_name) = LOWER(?)']
    const positional: unknown[] = [q.entity]
    if (q.kind) {
      whereParts.push('ae.entity_kind = ?')
      positional.push(q.kind)
    }
    // ORDER BY columns don't need to be projected in SQLite — we sort by
    // ae.mentions / a.published_at without pulling them through, so the
    // result row matches Article exactly. urgency is included in the
    // SELECT alongside category so callers (recent / search / breaking /
    // search_by_entity) see the same Article shape regardless of the
    // surface they came in through.
    const sql = `
      SELECT a.id, a.feed, a.category, a.urgency, a.urgency_reason, a.title, a.summary, a.url,
             a.published_at, a.fetched_at
      FROM article_entities ae
      JOIN articles a ON a.id = ae.article_id
      WHERE ${whereParts.join(' AND ')}
      ORDER BY ae.mentions DESC, a.published_at DESC
      LIMIT ?
    `
    positional.push(q.limit)
    return this.db.prepare(sql).all(...positional) as Article[]
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM articles').get() as { n: number }
    return row.n
  }

  // Total entity rows across all articles. Useful for the boot log so
  // we can eyeball coverage on each restart — a stale-zero number on a
  // populated articles table signals an extractor regression.
  entityCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM article_entities').get() as {
      n: number
    }
    return row.n
  }

  close(): void {
    this.db.close()
  }
}
