### Fixed
- News breaking surface no longer surfaces stale items (#348): `news_feeds.breaking`
  now bounds results to a recency window (default the last 48h) instead of returning
  any high-urgency article regardless of age — clearing the bug where a quiet feed
  pool let a 28-day-old item show in the News app's Breaking view and voice "what's
  breaking". `breaking()` applies a `published_at >= since` floor exactly the way
  `recent()` already does (same column, same `idx_articles_urgency_published_at`
  index); the 48h default is owned by the breaking handler. Callers can widen/narrow
  the window with the new optional `hours` param or pin an explicit `since` ISO
  datetime — both the renderer and the `news_breaking` voice tool consume the same
  default. No new edges. Closes #348.
