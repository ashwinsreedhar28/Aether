### Added
- Music gains memory, library, and touch (#334, Lane C of the vertical).
  The node grows two library reads — `music.playlists` (one page at the
  API-max 50, `{ name, uri, track_count }` plus the account-wide `total`)
  and `music.recently_played` (`limit` 1-50, default 10,
  `{ name, artist, uri, played_at }`, most recent first) — both on the
  Actor auth posture (explicit user intent may open the browser grant;
  no active device needed), with `raven → music.*` and `shell → music.*`
  manifest edges for each. raven gains three voice tools: `play_playlist`
  (case-insensitive fuzzy match — exact, then substring, then a difflib
  close-match; no match returns a spoken line naming what was heard),
  `play_last_song` (`recently_played[0]` → play), and `list_playlists`
  (spoken read-out capped at five names with a total count) — all
  non-confirm-gated per the standing #225 media-controls ruling. The
  Music app becomes interactive per the #334 ADR ("apps are interactive
  MeshApps; panels stay display-only"): prev / play-pause / next as ghost
  circular controls over the existing `shell → music.{skip,pause,play}`
  edges, with optimistic play-state and controls disabled in the empty
  state. Same diff restyles the now-playing card per the Director's
  addendum: blurred oversized album-art backdrop under an edge-dense
  gradient, 300ms crossfades on track change, larger ringed art that dims
  with a pause glyph when paused, a 3-bar equalizer beside the title
  replacing the header state chip, a rounded 6px progress bar with a
  position dot, and a ghosted empty-state glyph. Closes #334.
