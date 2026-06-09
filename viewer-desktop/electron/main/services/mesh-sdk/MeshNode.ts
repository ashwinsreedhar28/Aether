import { randomUUID } from 'node:crypto'
import { sign } from './canonical.ts'
import {
  MeshDeny,
  MeshError,
  type Envelope,
  type EnvelopeKind,
  type Handler,
  type RegisterResponse,
  type SurfaceInfo,
} from './types.ts'

// Vendored from @aether/mesh-node-sdk (core/node_sdk_ts/src/MeshNode.ts).
// Imports carry explicit `.ts` extensions so the file runs unchanged under
// Node's native TypeScript loader (used by viewerNode.test.ts via `node --test`).

export interface MeshNodeOptions {
  invokeTimeoutSeconds?: number
  logger?: (level: 'info' | 'warn' | 'error', msg: string, ...args: unknown[]) => void
}

const nowIso = (): string => new Date().toISOString()

const defaultLogger: NonNullable<MeshNodeOptions['logger']> = (level, msg, ...args) => {
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  sink(`[mesh-node-sdk] ${msg}`, ...args)
}

// Port of _ingest/RAVEN_MESH/node_sdk/__init__.py. Surfaces match the Python
// SDK so the round-trip exercises the same contract Python nodes use.
export class MeshNode {
  readonly nodeId: string
  readonly coreUrl: string
  readonly invokeTimeoutMs: number
  private readonly secret: string
  private readonly handlers = new Map<string, Handler>()
  private readonly log: NonNullable<MeshNodeOptions['logger']>
  private sessionId: string | null = null
  private surfaces: SurfaceInfo[] = []
  private streamAbort: AbortController | null = null
  private streamLoop: Promise<void> | null = null
  private stopped = false

  constructor(nodeId: string, secret: string, coreUrl: string, opts: MeshNodeOptions = {}) {
    this.nodeId = nodeId
    this.secret = secret
    this.coreUrl = coreUrl.replace(/\/+$/, '')
    this.invokeTimeoutMs = Math.round((opts.invokeTimeoutSeconds ?? 30) * 1000)
    this.log = opts.logger ?? defaultLogger
  }

  on(surfaceName: string, handler: Handler): void {
    this.handlers.set(surfaceName, handler)
  }

  async start(): Promise<void> {
    if (this.stopped) throw new Error('MeshNode already stopped; create a new instance')
    await this.register()
    await this.openStream()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.streamAbort?.abort()
    try {
      await this.streamLoop
    } catch {
      /* expected on abort */
    }
    this.streamAbort = null
    this.streamLoop = null
  }

  async invoke(
    target: string,
    payload: Record<string, unknown>,
    opts: { wait?: boolean; correlationId?: string; wrapped?: Envelope } = {},
  ): Promise<Envelope | { id: string; status: 'accepted' }> {
    const env = this.buildEnvelope('invocation', target, payload, opts.correlationId, opts.wrapped)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.invokeTimeoutMs + 5000)
    try {
      const res = await fetch(`${this.coreUrl}/v0/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(env),
        signal: ctrl.signal,
      })
      const data = (await res.json()) as Record<string, unknown>
      if (res.status === 202) return { id: env.id, status: 'accepted' }
      if (res.status !== 200) throw new MeshError(res.status, data)
      if (opts.wait === false) return { id: env.id, status: 'accepted' }
      return data as unknown as Envelope
    } finally {
      clearTimeout(timer)
    }
  }

  async respond(
    original: Envelope,
    payload: Record<string, unknown>,
    kind: EnvelopeKind = 'response',
  ): Promise<void> {
    const env: Record<string, unknown> = {
      id: randomUUID(),
      correlation_id: original.id,
      from: this.nodeId,
      to: original.from,
      kind,
      payload,
      timestamp: nowIso(),
    }
    env.signature = sign(env, this.secret)
    const res = await fetch(`${this.coreUrl}/v0/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(env),
    })
    if (res.status !== 200) {
      throw new MeshError(res.status, await res.json().catch(() => ({})))
    }
  }

  private buildEnvelope(
    kind: EnvelopeKind,
    to: string,
    payload: Record<string, unknown>,
    correlationId?: string,
    wrapped?: Envelope,
  ): Envelope {
    const id = randomUUID()
    const env: Record<string, unknown> = {
      id,
      correlation_id: correlationId ?? id,
      from: this.nodeId,
      to,
      kind,
      payload,
      timestamp: nowIso(),
    }
    if (wrapped) env.wrapped = wrapped
    env.signature = sign(env, this.secret)
    return env as unknown as Envelope
  }

  private async register(): Promise<void> {
    const body: Record<string, unknown> = { node_id: this.nodeId, timestamp: nowIso() }
    body.signature = sign(body, this.secret)
    const res = await fetch(`${this.coreUrl}/v0/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as RegisterResponse | { error: string }
    if (res.status !== 200) throw new MeshError(res.status, data)
    this.sessionId = (data as RegisterResponse).session_id
    this.surfaces = (data as RegisterResponse).surfaces
  }

  private async openStream(): Promise<void> {
    if (!this.sessionId) throw new Error('openStream called before register')
    const ctrl = new AbortController()
    this.streamAbort = ctrl
    let resolveHello: (() => void) | null = null
    const hello = new Promise<void>((r) => {
      resolveHello = r
    })
    this.streamLoop = this.streamConsume(ctrl, () => resolveHello?.()).catch((err) => {
      if (!this.stopped) this.log('warn', `stream ended: ${(err as Error).message}`)
    })
    // Wait up to 5s for hello, but don't fail if it doesn't arrive — matches Python SDK.
    await Promise.race([hello, new Promise<void>((r) => setTimeout(r, 5000))])
  }

  private async streamConsume(ctrl: AbortController, onHello: () => void): Promise<void> {
    const url = `${this.coreUrl}/v0/stream?session=${encodeURIComponent(this.sessionId!)}`
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'text/event-stream' } })
    if (res.status !== 200 || !res.body) throw new Error(`stream rejected: ${res.status}`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buf = ''
    let eventType: string | null = null
    let dataLines: string[] = []
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        for (let nl = buf.indexOf('\n'); nl !== -1; nl = buf.indexOf('\n')) {
          const line = buf.slice(0, nl).replace(/\r$/, '')
          buf = buf.slice(nl + 1)
          if (line === '') {
            if (eventType && dataLines.length > 0) {
              let data: unknown = dataLines.join('\n')
              try {
                data = JSON.parse(data as string)
              } catch {
                /* keep raw */
              }
              if (eventType === 'hello') onHello()
              else if (eventType === 'deliver') void this.dispatch(data as Envelope)
            }
            eventType = null
            dataLines = []
          } else if (line.startsWith('event:')) eventType = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
          // SSE comments (`:`) and unrecognized fields are silently dropped.
        }
      }
    } finally {
      try {
        reader.releaseLock()
      } catch {
        /* ignore */
      }
    }
  }

  private async dispatch(env: Envelope): Promise<void> {
    const surfaceName = (env.to ?? '').includes('.')
      ? env.to.slice(env.to.indexOf('.') + 1)
      : (env.to ?? '')
    const handler = this.handlers.get(surfaceName)
    const mode =
      this.surfaces.find((s) => s.name === surfaceName)?.invocation_mode ?? 'request_response'
    const isFnf = mode === 'fire_and_forget'
    if (!handler) {
      if (!isFnf) await this.tryRespond(env, { reason: 'no_handler', surface: surfaceName }, 'error')
      return
    }
    try {
      const result = await handler(env)
      if (isFnf || result == null) return
      await this.tryRespond(env, result, 'response')
    } catch (e) {
      if (isFnf) return
      if (e instanceof MeshDeny) {
        await this.tryRespond(env, { reason: e.reason, ...e.details }, 'error')
      } else {
        this.log('warn', `[${this.nodeId}] handler raised:`, e)
        await this.tryRespond(
          env,
          { reason: 'handler_exception', details: String((e as Error).message ?? e) },
          'error',
        )
      }
    }
  }

  private async tryRespond(
    original: Envelope,
    payload: Record<string, unknown>,
    kind: EnvelopeKind,
  ): Promise<void> {
    try {
      await this.respond(original, payload, kind)
    } catch (e) {
      this.log('warn', `[${this.nodeId}] respond failed:`, e)
    }
  }
}
