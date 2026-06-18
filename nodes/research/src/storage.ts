import Database from 'better-sqlite3'
import type { ResearchBrief, ResearchBriefSection, ResearchPaper } from './types'

// Forward-only schema version (PRAGMA user_version). Bump + add a migration
// step when the table shape changes; node-local DBs never roll back.
const DB_VERSION = 1

// Per-node brief store. Each research.brief call persists its result so
// research.recent can recall "what did I find on X" without re-calling
// Claude (and so the briefs feed the living-brain corpus later). sections
// and papers are stored as JSON blobs — they're read back whole, never
// queried by their inner fields, so a relational decomposition would buy
// nothing. Writes are synchronous; recall reads are sub-ms at this volume.
export class BriefStore {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS briefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        sections TEXT NOT NULL,
        papers TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_briefs_generated_at
        ON briefs(generated_at DESC);
    `)
    this.migrate()
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    const v = row.user_version
    // v0 → v1 is the initial CREATE above (idempotent under IF NOT EXISTS);
    // just stamp the version so a future bump has a known floor.
    if (v < 1) {
      this.db.pragma('user_version = 1')
    }
    const after = (this.db.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version
    if (after !== DB_VERSION) {
      throw new Error(
        `research: DB schema at user_version=${after}, code expects ${DB_VERSION}. Missing migration step.`,
      )
    }
  }

  // Persist one brief; returns the generatedAt stamp it was stored under.
  save(brief: ResearchBrief): void {
    this.db
      .prepare(
        `INSERT INTO briefs (query, generated_at, sections, papers)
         VALUES (@query, @generated_at, @sections, @papers)`,
      )
      .run({
        query: brief.query,
        generated_at: brief.generatedAt,
        sections: JSON.stringify(brief.sections),
        papers: JSON.stringify(brief.papers),
      })
  }

  // Most-recent briefs, newest first. Rows with corrupt JSON are skipped
  // rather than crashing the recall path.
  recent(limit: number): ResearchBrief[] {
    const rows = this.db
      .prepare(
        `SELECT query, generated_at, sections, papers
         FROM briefs
         ORDER BY generated_at DESC, id DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      query: string
      generated_at: string
      sections: string
      papers: string
    }>
    const out: ResearchBrief[] = []
    for (const r of rows) {
      try {
        out.push({
          query: r.query,
          generatedAt: r.generated_at,
          sections: JSON.parse(r.sections) as ResearchBriefSection[],
          papers: JSON.parse(r.papers) as ResearchPaper[],
        })
      } catch {
        // Skip a corrupt row — recall degrades gracefully, never throws.
      }
    }
    return out
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM briefs').get() as { n: number }
    return row.n
  }

  close(): void {
    this.db.close()
  }
}
