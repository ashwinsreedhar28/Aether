// Vendored slice of @aether/mesh-node-sdk. viewer-desktop can't depend on the
// (private, unpublished) workspace package, so the three dependency-light files
// — canonical.ts, types.ts, MeshNode.ts — live here and are imported locally.
export { MeshNode } from './MeshNode.ts'
export type { MeshNodeOptions } from './MeshNode.ts'
export { MeshDeny, MeshError } from './types.ts'
export type {
  Envelope,
  EnvelopeKind,
  Handler,
  HandlerResult,
  RegisterResponse,
  SurfaceInfo,
} from './types.ts'
