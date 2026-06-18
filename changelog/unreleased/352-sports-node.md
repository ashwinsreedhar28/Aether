### Added
- Sports vertical — node, voice, and app, end-to-end (#352). A new
  request-driven **Sports Sensor** over ESPN's public site API (no API
  key, in-memory per-surface TTL cache) exposes `sports.leagues` (catalog
  with per-call in-season/in-playoffs flags), `sports.scores` (single-date
  scoreboard, ~15s), `sports.game` (box-score detail, ~60s), and
  `sports.teams` (team directory, ~24h), across twelve leagues including a
  date-bounded **2026 FIFA World Cup** window. Three `sports_*` **voice
  tools** (scores / game / leagues) speak the slate, box scores, and what's
  in season — "what's the NBA score", "did the Lakers win", "what's in
  season". A **Sports MeshApp** shows the live slate as league tabs of game
  tiles, each tapping through to a box score (team-stat comparison, curated
  to R/H/E + key lines for MLB's grouped box score); auto-discovered into
  cmd+P / Console / voice `open_app`.
