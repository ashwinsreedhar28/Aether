# music — Spotify playback Actor

Mesh node controlling Spotify playback over the Web API (#332, Lane A of the
#225 decomposition). Five Actor surfaces plus the `now_playing` sensor
surface. Raven's `music_tool` group and the Viewer now-playing app are Lane B
(#225) — this node is their substrate.

## Surfaces

- `music.play` — `{ query?, uri? }`. A query resolves via track search (first
  match plays); a `spotify:<type>:<id>` URI or open.spotify.com link plays
  directly (track URIs as `uris`, album/playlist/artist as `context_uri`).
  `uri` wins when both are supplied.
- `music.pause` — no params.
- `music.skip` — `{ direction?: 'next' | 'prev' }`, default `next`.
- `music.queue` — `{ query?, uri? }`, appends to the active device's queue.
- `music.search` — `{ query, limit? (1-20, default 5) }` → 
  `{ tracks: [{ name, artist, uri }], fetched_at_ms }`.
- `music.now_playing` — no params →
  `{ is_playing, track: { name, artist, album, uri, duration_ms } | null,
  position_ms, fetched_at_ms, source: 'cache' | 'live' }`.

## Auth — Authorization Code with PKCE

`SPOTIFY_CLIENT_ID` comes from `.env.local` (see `.env.local.example`); there
is **no client secret** anywhere in the repo or env — PKCE replaces it. The
Spotify developer app must register the redirect URI
`http://127.0.0.1:8898/callback` (Director prereq in #332).

- First authenticated **Actor** call (e.g. `music.play`): the node opens the
  system browser to the Spotify grant page, a one-shot loopback listener on
  `127.0.0.1:8898/callback` catches the code, and the refresh token is cached
  at `$AETHER_DATA_DIR/music/spotify_tokens.json` with owner-only (0600)
  permissions. The grant has a 300s timeout (`music_auth_timeout`); a second
  call while it is pending denies `music_auth_pending`.
- Subsequent calls and node restarts: silent refresh from the cache, no
  browser. PKCE refresh tokens rotate; the cache is rewritten on each refresh.
- `music.now_playing` is the read path and **never** opens the browser: with
  no cached token it denies `music_not_authenticated` by name.

## Named errors (never silent, never hanging)

`music_no_client_id` (SPOTIFY_CLIENT_ID unset) · `music_not_authenticated` ·
`music_auth_denied` / `music_auth_timeout` / `music_auth_pending` /
`music_auth_state_mismatch` / `music_callback_port_busy` ·
`music_token_revoked` (cache dropped; re-grant on next Actor call) ·
`music_no_active_device` — Spotify Connect needs an active device; open the
Spotify app and play/pause anything once, then retry ·
`music_no_match` / `music_bad_uri` / `music_bad_args` / `music_bad_direction`
/ `music_bad_query` · `music_rate_limited` · `music_forbidden` (commonly:
account is not Premium — player commands are Premium-only) ·
`music_api_error` / `music_spotify_unreachable`.

## now_playing cadence

Spotify is polled at 3s **only** while playback is active or was active in
the last 60s; the loop then stops — zero standing API traffic at rest. An
on-demand `now_playing` call while idle performs one live read (and re-arms
the poller if it reveals active playback). A track change observed by any
read emits a `host_notifications.notify` change event
("Now playing: <name> — <artist>"; lanes-sensor precedent — failures logged
and swallowed).

## Smoke (#332, Director-runnable, no voice)

Prereqs: `SPOTIFY_CLIENT_ID` in `.env.local`; Spotify app open and recently
played (an active device exists). From the running shell's devtools console
(the house signed-envelope test path — renderer `mesh.invoke` routes as the
`shell` node over the manifest's `shell → music.*` edges):

```js
await window.aether.mesh.invoke('music.play', { query: 'so what miles davis' })
// → browser grant on first run, then playback starts on the active device
await window.aether.mesh.invoke('music.now_playing', {})
await window.aether.mesh.invoke('music.pause', {})
await window.aether.mesh.invoke('music.skip', { direction: 'next' })
```

Then restart the node (quit/relaunch the shell): the cached refresh token
authenticates with no browser re-prompt — check `$userData/mesh/music.log`
for `cached refresh token present`.

Note: the mesh invoke timeout is ~30s; if the first-run browser grant takes
longer, that one invoke times out client-side while the node completes the
flow — just re-issue the call after granting.

## Tests

`pnpm --filter @aether/music test` — handlers against a fake client (uri
normalization, query resolution, named-deny paths), poller change-event
semantics, auth refusals + refresh rotation + 0600 cache, and the client's
error mapping (NO_ACTIVE_DEVICE → `music_no_active_device`, single 401
retry, 429).
