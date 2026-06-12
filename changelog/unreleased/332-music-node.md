### Added
- `music` mesh node — Spotify playback Actor (#332, Lane A of the #225
  decomposition; raven tools + Viewer now-playing app follow in Lane B).
  Five Actor surfaces (`music.play` — query or spotify uri, query resolves
  via search and plays the first match; `music.pause`; `music.skip`
  next|prev; `music.queue`; `music.search` → top tracks as
  `{ name, artist, uri }`) plus the `music.now_playing` sensor surface
  (`is_playing`, track name/artist/album/uri/duration, `position_ms`;
  polled at 3s only while playback is active or was in the last 60s, idle
  otherwise; on-demand live read when idle; observed track changes emit a
  `host_notifications.notify` change event). Auth is Authorization Code
  with PKCE: `SPOTIFY_CLIENT_ID` from `.env.local`, NO client secret —
  first Actor call opens the system browser, a one-shot loopback listener
  on `127.0.0.1:8898/callback` catches the code, and the rotating refresh
  token is cached owner-only (0600) under `AETHER_DATA_DIR/music/`, so
  restarts re-authenticate with no browser. Missing client id / missing
  token / no active Spotify Connect device all deny loudly by name
  (`music_no_client_id`, `music_not_authenticated`,
  `music_no_active_device` — "no active Spotify device"), never hang.
  Registered in `manifest.yaml` with raven Actor edges, the
  raven + shell `now_playing` read path, and shell edges backing the
  devtools signed-envelope smoke. Closes #332.
