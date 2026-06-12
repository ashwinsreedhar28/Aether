import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode } from '@aether/mesh-node-sdk'
import { SpotifyAuth } from './auth'
import { SpotifyClient } from './spotify'
import { NowPlayingPoller } from './nowPlaying'
import {
  makeNowPlayingHandler,
  makePauseHandler,
  makePlayHandler,
  makeQueueHandler,
  makeSearchHandler,
  makeSkipHandler,
} from './handlers'

// music is the mesh's Spotify playback Actor (#332, Lane A of the #225
// decomposition — the pipeline-validation vertical's substrate). Five Actor
// surfaces (play / pause / skip / queue / search) plus the now_playing
// sensor surface. Auth is Authorization Code with PKCE: SPOTIFY_CLIENT_ID
// only (no client secret anywhere), browser grant on the first
// authenticated Actor call, refresh token cached owner-only under
// AETHER_DATA_DIR/music/, silent refresh thereafter. A missing CLIENT_ID
// boots degraded: the node registers and every surface denies
// music_no_client_id by name — nothing hangs, nothing crashes.

const NODE_ID = 'music'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

function log(msg: string): void {
  // Plain stdout is safe here — Core consumes HTTP/SSE over loopback, not
  // stdout (CLAUDE.md §10 applies only to JSON-RPC daemons).
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

async function main(): Promise<void> {
  const secret = process.env.MESH_MUSIC_SECRET
  if (!secret) {
    process.stderr.write(`[${NODE_ID}] MESH_MUSIC_SECRET is required; refusing to start.\n`)
    process.exit(2)
  }
  const dataDir = process.env.AETHER_DATA_DIR
  if (!dataDir) {
    process.stderr.write(`[${NODE_ID}] AETHER_DATA_DIR is required; refusing to start.\n`)
    process.exit(2)
  }

  const nodeDir = join(dataDir, NODE_ID)
  mkdirSync(nodeDir, { recursive: true })
  const markerPath = join(nodeDir, 'running')

  // Missing CLIENT_ID is NOT fatal (github-node degraded precedent): boot,
  // register, deny by name on use.
  const clientId = (process.env.SPOTIFY_CLIENT_ID ?? '').trim() || null
  const auth = new SpotifyAuth({ clientId, cacheDir: nodeDir, log })
  const client = new SpotifyClient({
    getToken: async ({ interactive, forceRefresh }) => {
      if (forceRefresh) auth.invalidateAccessToken()
      return auth.getAccessToken({ interactive })
    },
    log,
  })

  const node = new MeshNode(NODE_ID, secret, CORE_URL)

  const poller = new NowPlayingPoller({
    // Sensor reads are never interactive — a poll must not pop a browser.
    fetchState: () => client.playbackState(false),
    onTrackChange: (track) => {
      // Change event on the house emission rail (lanes-sensor precedent):
      // fire-and-forget from our perspective — a missing edge or a down
      // notifier is logged and swallowed, never crashes the poller.
      void node
        .invoke('host_notifications.notify', {
          title: 'Aether',
          body: `Now playing: ${track.name} — ${track.artist}`,
        })
        .then((resp) => {
          if ('kind' in resp && resp.kind === 'error') {
            const reason =
              typeof resp.payload?.reason === 'string' ? resp.payload.reason : 'unknown'
            log(`track-change notify denied: ${reason}`)
          }
        })
        .catch((err) => {
          log(`track-change notify failed: ${err instanceof Error ? err.message : String(err)}`)
        })
    },
    log,
  })

  const deps = { client, poller, log }
  node.on('play', makePlayHandler(deps))
  node.on('pause', makePauseHandler(deps))
  node.on('skip', makeSkipHandler(deps))
  node.on('queue', makeQueueHandler(deps))
  node.on('search', makeSearchHandler(deps))
  node.on('now_playing', makeNowPlayingHandler(deps))
  await node.start()
  log(
    `registered with core at ${CORE_URL}; SPOTIFY_CLIENT_ID ${
      clientId ? 'present' : 'ABSENT — all surfaces deny music_no_client_id'
    }; cached refresh token ${auth.hasCachedToken() ? 'present' : 'absent'}`,
  )

  writeFileSync(markerPath, `${process.pid}\n${new Date().toISOString()}\n`)
  log(`liveness marker written to ${markerPath}`)

  let shuttingDown = false
  const shutdown = async (sig: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    log(`received ${sig}, stopping`)
    poller.stop()
    try {
      unlinkSync(markerPath)
    } catch {
      /* already gone */
    }
    try {
      await node.stop()
    } catch {
      /* best-effort */
    }
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  process.stderr.write(`[${NODE_ID}] fatal: ${(err as Error).stack ?? err}\n`)
  process.exit(1)
})
