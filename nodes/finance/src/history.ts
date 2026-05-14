import Database from 'better-sqlite3'

// SQLite-backed time series of *historical* quote samples. Separate
// concern from the in-memory current-quote cache (storage.ts), which
// stays in-memory by design (see DECISIONS.md "Second data node:
// finance via Finnhub" — persisting a *current* price would mislead
// consumers across restarts). What's persisted here is the polled
// time series itself: every successful poll appends one row per
// symbol, and `finance.history` reads the accumulated series back.
// First-day installs honestly return empty — no backfill from training
// data or upstream historical endpoints (see DECISIONS.md "Finance
// historical quotes via passive accumulation").
//
// Bump this when the schema changes. The constructor checks PRAGMA
// user_version against this constant and applies forward-only
// migrations when stored < current. No down-migration.
const DB_VERSION = 1

// Rolling retention. Older rows are pruned at the start of each poll
// cycle so the DB never grows unbounded. 90 days is generous for a
// 5-min cadence (~26k rows/symbol/quarter) and leaves headroom if
// the voice tool grows longer-period readbacks ("AAPL over the past
// two months").
const RETENTION_DAYS = 90

export interface HistorySample {
  symbol: string
  fetched_at: string
  price: number
  change: number
  change_percent: number
}

// Shape returned by `finance.history`. Narrower than HistorySample on
// purpose — the renderer's sparkline only needs price, and the voice
// tool's summary only needs price + a way to label the latest. Dropping
// `change` here keeps the surface response small (one fewer float per
// row) without losing anything callers use.
export interface HistoryPoint {
  fetched_at: string
  price: number
  change_percent: number
}

export class QuoteHistory {
  private readonly db: Database.Database
  private readonly insertStmt: Database.Statement
  private readonly pointsStmt: Database.Statement
  private readonly pruneStmt: Database.Statement

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    // WAL keeps history reads responsive while a poll is appending.
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    // Fresh-install schema: applied verbatim when the DB is empty. Both
    // columns referenced by idx_qh_symbol_fetched_at exist from v1, so
    // creating the index alongside the table is safe — the §10 gotcha
    // ("CREATE INDEX IF NOT EXISTS still fails when the column doesn't
    // exist yet on a pre-migration database") only bites when an index
    // depends on a column that an ALTER TABLE will add later. Future
    // ALTER+INDEX pairs go inside migrate(), not here.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quotes_history (
        symbol TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        price REAL NOT NULL,
        change REAL NOT NULL,
        change_percent REAL NOT NULL,
        PRIMARY KEY (symbol, fetched_at)
      );
      CREATE INDEX IF NOT EXISTS idx_qh_symbol_fetched_at
        ON quotes_history(symbol, fetched_at DESC);
    `)
    this.migrate()
    this.insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO quotes_history
        (symbol, fetched_at, price, change, change_percent)
      VALUES (?, ?, ?, ?, ?)
    `)
    this.pointsStmt = this.db.prepare(`
      SELECT fetched_at, price, change_percent
      FROM quotes_history
      WHERE symbol = ? AND fetched_at >= ?
      ORDER BY fetched_at ASC
    `)
    this.pruneStmt = this.db.prepare(
      `DELETE FROM quotes_history WHERE fetched_at < ?`,
    )
  }

  // Forward-only migrations. No-op for v1 — the initial CREATE is
  // already self-contained — but the scaffolding exists so future
  // versions can ALTER TABLE + CREATE INDEX inside one transaction
  // without re-learning CLAUDE.md §10.
  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as {
      user_version: number
    }
    let v = row.user_version
    if (v < 1) {
      // Marker bump. Fresh installs land here; their CREATE TABLE
      // above already provisioned everything v1 needs, so the
      // transaction body is empty.
      const apply = this.db.transaction(() => {
        this.db.pragma(`user_version = 1`)
      })
      apply()
      v = 1
    }
    if (v !== DB_VERSION) {
      throw new Error(
        `finance.history: DB schema at user_version=${v}, ` +
          `code expects ${DB_VERSION}. Missing migration step.`,
      )
    }
  }

  // INSERT OR IGNORE: re-running a poll that re-fetched within the
  // same second (clock skew, rapid restart) does not error or
  // overwrite. The (symbol, fetched_at) PK makes duplicates harmless.
  insert(sample: HistorySample): void {
    this.insertStmt.run(
      sample.symbol.toUpperCase(),
      sample.fetched_at,
      sample.price,
      sample.change,
      sample.change_percent,
    )
  }

  // Oldest-first time series for one symbol since `sinceIso`. Empty
  // array if nothing has been collected — not an error; the handler
  // surfaces it as `{points: []}` and the voice tool decides whether
  // to read "insufficient history" aloud.
  points(symbol: string, sinceIso: string): HistoryPoint[] {
    return this.pointsStmt.all(
      symbol.toUpperCase(),
      sinceIso,
    ) as HistoryPoint[]
  }

  // Drops rows older than the retention window. Returns the row count
  // pruned so the poller can log it. Called from the poller at the
  // start of each cycle — that's the only place the DB grows, so it's
  // the cheapest cadence that keeps the rolling window honest.
  pruneOlderThan(cutoffIso: string): number {
    const r = this.pruneStmt.run(cutoffIso)
    return r.changes
  }

  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM quotes_history')
      .get() as { n: number }
    return row.n
  }

  close(): void {
    this.db.close()
  }
}

export { RETENTION_DAYS }
