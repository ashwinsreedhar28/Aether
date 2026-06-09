// Vendored from @aether/mesh-node-sdk (core/node_sdk_ts/src/types.ts).
// The error classes are rewritten to declare fields explicitly rather than via
// TypeScript parameter properties, because viewer-desktop's tsconfig.electron
// sets `erasableSyntaxOnly` (parameter properties emit runtime code).

export type EnvelopeKind = 'invocation' | 'response' | 'error'

export interface Envelope {
  id: string
  correlation_id: string
  from: string
  to: string
  kind: EnvelopeKind
  payload: Record<string, unknown>
  wrapped?: Envelope
  timestamp: string
  signature: string
}

export interface RegisterResponse {
  session_id: string
  node_id: string
  kind: string | null
  surfaces: SurfaceInfo[]
  relationships: { from: string; to: string }[]
}

export interface SurfaceInfo {
  name: string
  type: 'tool' | 'inbox'
  invocation_mode: 'request_response' | 'fire_and_forget'
}

// A handler returns:
//   * a plain object  → sent as the response envelope's payload
//   * null / undefined → no response sent (intended for fire_and_forget)
//   * throw MeshDeny  → kind=error response with reason + details
//   * throw anything  → kind=error response with handler_exception
export type HandlerResult = Record<string, unknown> | null | void
export type Handler = (env: Envelope) => Promise<HandlerResult> | HandlerResult

export class MeshError extends Error {
  readonly status: number
  readonly data: unknown

  constructor(status: number, data: unknown) {
    super(`mesh error ${status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
    this.name = 'MeshError'
    this.status = status
    this.data = data
  }
}

// Handler-side denial. Throw this from an `.on()` handler to send Core a
// signed `kind: "error"` response envelope with the given reason + details.
export class MeshDeny extends Error {
  readonly reason: string
  readonly details: Record<string, unknown>

  constructor(reason: string, details: Record<string, unknown> = {}) {
    super(reason)
    this.name = 'MeshDeny'
    this.reason = reason
    this.details = details
  }
}
