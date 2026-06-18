// Canonical Sports shapes. Lifted (data-source + algorithm geography
// only) from Pulse's src/main/services/sportsService.ts and re-housed in
// the Aether mesh-node pattern. The surface JSON schemas validate INPUTS;
// Core does not validate response payloads, so these interfaces are the
// single source of truth for what the four surfaces return.
//
// MVP trim (CLAUDE.md §11.8 — aggressively simplify lifted patterns):
// Pulse's GameDetail also carried per-player stat lines, league leaders
// with ESPN headshot URLs, MLB linescores, and a highlight-search query.
// Those are this vertical's explicit non-goals (leaders / favorites /
// headshots), so the lifted GameDetail keeps only the box-score essentials
// — the team-stat comparison and game headlines.

export type GameStatus =
  | 'scheduled'
  | 'in_progress'
  | 'final'
  | 'postponed'
  | 'canceled'

export interface GameTeam {
  id: string
  name: string
  shortName: string
  abbreviation: string
  logoURL: string | null
  score: number | null
  record: string | null
  isHome: boolean
  winner: boolean | null
  color: string | null
  altColor: string | null
}

export interface GameSeries {
  title: string | null
  homeWins: number
  awayWins: number
  summary: string | null
}

export interface Game {
  id: string
  leagueId: string
  leaguePath: string
  /** ms-since-epoch kickoff time (0 when ESPN omitted the date). */
  date: number
  status: GameStatus
  statusDetail: string
  statusShort: string
  period: number | null
  displayClock: string | null
  home: GameTeam
  away: GameTeam
  venue: string | null
  broadcasts: string[]
  note: string | null
  // Playoff series summary when ESPN's payload includes a multi-game
  // series (NBA/NHL/MLB postseason rounds, Finals). Null for regular
  // season and one-off knockout fixtures.
  series: GameSeries | null
}

export interface GameDetailStat {
  label: string
  home: string
  away: string
}

export interface GameHeadline {
  title: string
  description: string | null
  link: string | null
}

// Box-score detail = the base game header + the home/away team-stat
// comparison + a handful of headlines. See the MVP-trim note above.
export interface GameDetail extends Game {
  stats: GameDetailStat[]
  headlines: GameHeadline[]
}

export interface SportsTeam {
  id: string
  name: string
  displayName: string
  shortName: string
  abbreviation: string
  location: string | null
  logoURL: string | null
}

// Catalog row without the date-dependent flags. inSeason / inPlayoffs
// are computed per call (they change with the date), so they live on the
// returned SportsLeague, not the stored catalog entry.
export interface LeagueCatalogEntry {
  id: string
  name: string
  shortName: string
  sport: string
  /** ESPN path segments, e.g. 'basketball/nba'. */
  paths: string[]
}

export interface SportsLeague extends LeagueCatalogEntry {
  /** True when today sits inside the league's season window. */
  inSeason: boolean
  /** True when today sits inside the league's postseason window. */
  inPlayoffs: boolean
}

export interface SeasonRange {
  /** ms-since-epoch season start. */
  start: number
  /** ms-since-epoch season end. */
  end: number
  /** e.g. "2025-26" or "2026". */
  label: string
}
