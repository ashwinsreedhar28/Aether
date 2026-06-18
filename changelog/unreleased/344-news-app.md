### Added
- News app — the news vertical gets its face (#344, Wave 1 of the
  Pulse-vertical program; mirrors the music app over an existing node). A
  display MeshApp (`shell/src/apps/news`, auto-discovered into the Console /
  cmd+P / voice `open_app` like every other app) reads the `news_feeds`
  Sensor over its existing `shell → news_feeds.{recent,breaking}` edges: a
  category chip row in semantic `world…local` order re-invokes
  `news_feeds.recent` with a category filter, a leading Breaking toggle swaps
  the read to `news_feeds.breaking` (high-urgency only), and each article row
  carries title, source, relative published time, an urgency badge
  (grey/amber/red), a category tag, and summary — clicking one opens its url
  in the in-app browser, the same `openWindow` click-through the Gaps / Lanes
  boards use. RAVEN learns the face: `'news'` joins the `open_app` hint set
  and a prompts.json line maps "open the news app" → `open_app` id `'news'`.
  No new edges, no new voice tools — the `news_*` tools already shipped.
  Closes #344.
