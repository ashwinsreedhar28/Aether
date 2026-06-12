### Added
- Music vertical completes — voice + face (#225, Lane B over #332's node).
  raven gains the `music_tool` group (`play_music` — empty query resumes;
  `pause_music`; `skip_track` next|prev; `queue_music`; `whats_playing`),
  thin `mesh_invoke` wrappers over `music.*` that are deliberately NOT
  confirm-gated (media controls are non-destructive and instantly
  reversible; standing #225 ruling) and return pre-written `spoken` lines —
  named node denies surface as friendly speech (`music_no_active_device` →
  "Spotify isn't open on any device, sir…"). The Viewer gains a
  display-only Music app (`shell/src/apps/music`, listed in the Console
  like every other app): album art, track/artist/album, playing/paused
  state, and a progress bar interpolated client-side between its 3s
  `music.now_playing` polls — no buttons, voice is the remote. Node
  touches: `music.now_playing` now carries `album_art_url` (largest album
  image, null when absent), bare `music.play` (no query/uri) RESUMES via
  Spotify's bodyless player/play, and the per-track toast is opt-in behind
  `MUSIC_TOAST=1` (default off — the app is the visible surface). The
  manifest needed zero changes: Lane A pre-positioned every
  raven/shell → `music.*` edge. Closes #225.
