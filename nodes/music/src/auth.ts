// Spotify Authorization Code with PKCE (#332 FIX item 2). Client ID only —
// no client secret exists anywhere in this flow, which is exactly why PKCE
// is the right grant for a desktop-resident node. The browser flow runs at
// most once: the refresh token it yields is cached on disk (owner-only) and
// rotated on every refresh thereafter, so a node restart re-authenticates
// silently. Everything that can go wrong refuses loudly by name (MeshDeny)
// rather than hanging — the spec's hard requirement.

import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { MeshDeny } from '@aether/mesh-node-sdk'

const ACCOUNTS_BASE = 'https://accounts.spotify.com'
// Registered on the Spotify developer app (DIRECTOR PREREQ in #332). Loopback
// IP literal, not localhost — Spotify treats them as distinct redirect URIs.
const REDIRECT_PORT = 8898
const REDIRECT_PATH = '/callback'
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}${REDIRECT_PATH}`
// user-read-playback-state covers now_playing + device reads;
// user-modify-playback-state covers play/pause/skip/queue. Search needs no
// user scope, just a valid token.
const SCOPES = 'user-read-playback-state user-modify-playback-state'
// How long the one-shot loopback listener waits for the browser grant before
// tearing down with a named deny. Generous — the Director may need to log in
// to Spotify first — but finite, so a walked-away-from flow can't wedge the
// node's auth path forever.
const FLOW_TIMEOUT_MS = 300_000
// Refresh slightly early so a token can't expire mid-API-call.
const EXPIRY_SLACK_MS = 60_000

const TOKEN_FILE = 'spotify_tokens.json'

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
}

export interface SpotifyAuthDeps {
  /** null ⇔ SPOTIFY_CLIENT_ID unset — every token ask denies by name. */
  clientId: string | null
  /** Node-private dir (…/data/music). The token cache lives here, 0600. */
  cacheDir: string
  log: (msg: string) => void
  /** Injectable for tests; default opens the system browser. */
  openBrowser?: (url: string) => void
  now?: () => number
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function defaultOpenBrowser(url: string, log: (msg: string) => void): void {
  // macOS is the only supported host today (§11.7); the win32/linux branches
  // are best-effort so the Windows tree doesn't need to undo a darwin-only
  // assumption. If none of these work the URL is already in the log — the
  // grant page can be opened by hand and the loopback still catches it.
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  try {
    spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true }).unref()
  } catch (err) {
    log(`could not open browser (${err instanceof Error ? err.message : String(err)}) — open the URL from the log manually`)
  }
}

export class SpotifyAuth {
  private readonly deps: SpotifyAuthDeps
  private readonly tokenPath: string
  private accessToken: string | null = null
  private accessTokenExpiresAt = 0
  // Single-flight latches: concurrent surface calls share one refresh, and a
  // second interactive ask while the browser flow is pending denies by name
  // instead of opening a second grant tab.
  private refreshInFlight: Promise<string> | null = null
  private flowInFlight = false

  constructor(deps: SpotifyAuthDeps) {
    this.deps = deps
    this.tokenPath = join(deps.cacheDir, TOKEN_FILE)
  }

  /** True ⇔ a refresh token is cached on disk (no network touched). */
  hasCachedToken(): boolean {
    return this.readCachedRefreshToken() !== null
  }

  /**
   * Returns a live access token. `interactive` gates the browser flow:
   * Actor surfaces pass true (a missing cache starts the PKCE grant); the
   * now_playing read path passes false (a sensor poll must never pop a
   * browser) and denies `music_not_authenticated` instead.
   */
  async getAccessToken(opts: { interactive: boolean }): Promise<string> {
    if (!this.deps.clientId) {
      throw new MeshDeny('music_no_client_id', {
        message: 'SPOTIFY_CLIENT_ID is not set — add it to .env.local (see .env.local.example)',
      })
    }
    const now = (this.deps.now ?? Date.now)()
    if (this.accessToken && now < this.accessTokenExpiresAt - EXPIRY_SLACK_MS) {
      return this.accessToken
    }
    const cached = this.readCachedRefreshToken()
    if (cached) return this.refresh(cached)
    if (!opts.interactive) {
      throw new MeshDeny('music_not_authenticated', {
        message: 'no cached Spotify token — invoke an actor surface (e.g. music.play) once to run the browser grant',
      })
    }
    return this.runAuthorizationFlow()
  }

  /** Drops the in-memory access token so the next ask refreshes (401 path). */
  invalidateAccessToken(): void {
    this.accessToken = null
    this.accessTokenExpiresAt = 0
  }

  // ---- refresh path ---------------------------------------------------------

  private refresh(refreshToken: string): Promise<string> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refreshOnce(refreshToken).finally(() => {
        this.refreshInFlight = null
      })
    }
    return this.refreshInFlight
  }

  private async refreshOnce(refreshToken: string): Promise<string> {
    const res = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.deps.clientId!,
    })
    if (res.status === 400) {
      // invalid_grant ⇔ the cached token was revoked (deauthorized app,
      // password change). The cache is dead weight — drop it so the next
      // actor call runs a fresh grant instead of failing forever.
      this.clearCache()
      throw new MeshDeny('music_token_revoked', {
        message: 'cached Spotify refresh token was rejected — invoke music.play to re-authenticate',
      })
    }
    if (!res.ok) {
      throw new MeshDeny('music_auth_error', {
        message: `Spotify token refresh failed (HTTP ${res.status})`,
      })
    }
    const body = (await res.json()) as TokenResponse
    this.storeAccessToken(body)
    // PKCE refresh tokens rotate — persist the replacement or the NEXT
    // restart authenticates with a dead token and the silent path breaks.
    if (body.refresh_token) this.writeCache(body.refresh_token)
    return body.access_token
  }

  // ---- interactive PKCE flow ------------------------------------------------

  private async runAuthorizationFlow(): Promise<string> {
    if (this.flowInFlight) {
      throw new MeshDeny('music_auth_pending', {
        message: 'Spotify authorization is already in progress — complete the grant in the browser',
      })
    }
    this.flowInFlight = true
    try {
      const verifier = base64url(randomBytes(64))
      const challenge = base64url(createHash('sha256').update(verifier).digest())
      const state = base64url(randomBytes(16))
      const authUrl =
        `${ACCOUNTS_BASE}/authorize?` +
        new URLSearchParams({
          response_type: 'code',
          client_id: this.deps.clientId!,
          scope: SCOPES,
          redirect_uri: REDIRECT_URI,
          state,
          code_challenge_method: 'S256',
          code_challenge: challenge,
        }).toString()

      const codePromise = this.captureCallback(state)
      this.deps.log(`opening Spotify grant page: ${authUrl}`)
      ;(this.deps.openBrowser ?? ((url: string) => defaultOpenBrowser(url, this.deps.log)))(authUrl)
      const code = await codePromise

      const res = await this.tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: this.deps.clientId!,
        code_verifier: verifier,
      })
      if (!res.ok) {
        throw new MeshDeny('music_auth_error', {
          message: `Spotify code exchange failed (HTTP ${res.status})`,
        })
      }
      const body = (await res.json()) as TokenResponse
      if (!body.refresh_token) {
        throw new MeshDeny('music_auth_error', {
          message: 'Spotify code exchange returned no refresh token',
        })
      }
      this.storeAccessToken(body)
      this.writeCache(body.refresh_token)
      this.deps.log('Spotify grant complete; refresh token cached')
      return body.access_token
    } finally {
      this.flowInFlight = false
    }
  }

  /** One-shot loopback listener: resolves with the auth code or denies by name. */
  private captureCallback(expectedState: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let server: Server | null = null
      let timer: NodeJS.Timeout | null = null
      const settle = (fn: () => void): void => {
        if (timer) clearTimeout(timer)
        server?.close()
        server = null
        fn()
      }
      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${REDIRECT_PORT}`)
        if (url.pathname !== REDIRECT_PATH) {
          res.writeHead(404).end()
          return
        }
        const finishPage = (text: string): void => {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(`<html><body><p>${text}</p></body></html>`)
        }
        const error = url.searchParams.get('error')
        if (error) {
          finishPage('Spotify authorization was denied. You can close this tab.')
          settle(() =>
            reject(new MeshDeny('music_auth_denied', { message: `Spotify grant denied: ${error}` })),
          )
          return
        }
        if (url.searchParams.get('state') !== expectedState) {
          finishPage('State mismatch — authorization rejected. You can close this tab.')
          settle(() =>
            reject(
              new MeshDeny('music_auth_state_mismatch', {
                message: 'OAuth state mismatch on the loopback callback',
              }),
            ),
          )
          return
        }
        const code = url.searchParams.get('code')
        if (!code) {
          finishPage('Missing authorization code. You can close this tab.')
          settle(() =>
            reject(new MeshDeny('music_auth_error', { message: 'callback carried no code' })),
          )
          return
        }
        finishPage('Aether is connected to Spotify. You can close this tab.')
        settle(() => resolve(code))
      })
      server.on('error', (err: NodeJS.ErrnoException) => {
        settle(() =>
          reject(
            err.code === 'EADDRINUSE'
              ? new MeshDeny('music_callback_port_busy', {
                  message: `port ${REDIRECT_PORT} is in use — the loopback listener cannot start`,
                })
              : new MeshDeny('music_auth_error', { message: `loopback listener failed: ${err.message}` }),
          ),
        )
      })
      timer = setTimeout(() => {
        settle(() =>
          reject(
            new MeshDeny('music_auth_timeout', {
              message: `Spotify grant not completed within ${FLOW_TIMEOUT_MS / 1000}s`,
            }),
          ),
        )
      }, FLOW_TIMEOUT_MS)
      server.listen(REDIRECT_PORT, '127.0.0.1')
    })
  }

  // ---- token plumbing --------------------------------------------------------

  private tokenRequest(form: Record<string, string>): Promise<Response> {
    return fetch(`${ACCOUNTS_BASE}/api/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    })
  }

  private storeAccessToken(body: TokenResponse): void {
    this.accessToken = body.access_token
    this.accessTokenExpiresAt = (this.deps.now ?? Date.now)() + body.expires_in * 1000
  }

  private readCachedRefreshToken(): string | null {
    if (!existsSync(this.tokenPath)) return null
    try {
      const parsed = JSON.parse(readFileSync(this.tokenPath, 'utf8')) as {
        refresh_token?: unknown
      }
      return typeof parsed.refresh_token === 'string' && parsed.refresh_token.length > 0
        ? parsed.refresh_token
        : null
    } catch {
      return null
    }
  }

  private writeCache(refreshToken: string): void {
    // Owner-only at rest (#332 FIX item 2). mode applies on create; the
    // explicit chmod covers a pre-existing file with looser bits.
    writeFileSync(
      this.tokenPath,
      JSON.stringify({ refresh_token: refreshToken, obtained_at: new Date().toISOString() }) + '\n',
      { mode: 0o600 },
    )
    chmodSync(this.tokenPath, 0o600)
  }

  private clearCache(): void {
    try {
      unlinkSync(this.tokenPath)
    } catch {
      /* already gone */
    }
  }
}
