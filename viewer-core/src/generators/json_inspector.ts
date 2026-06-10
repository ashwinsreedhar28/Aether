/**
 * The json_inspector generator — a collapsible JSON tree from realistic data.
 *
 * A pure `build(params) -> View[]` that emits ONE `json` View whose inline
 * source is a JSON string the shared json renderer parses into a collapsible
 * tree (see renderers/json.tsx: it reads `data.content` and renders the parsed
 * value as an expandable node tree).
 *
 * The value is serialized with `JSON.stringify` (no spaces), so it is
 * byte-identical to the Python mirror's `json.dumps(..., separators=(",",":"))`
 * (python/generators/json_inspector.py) for the same input — that string
 * identity is what the cross-language parity test pins down. Calling with no
 * params yields a real demo: a fake "mesh introspect" payload of 3 Lattice mesh
 * nodes, each with its exposed surfaces and peers.
 */
import type { View } from '../schema/view';
import type { GeneratorEntry } from './types';
import { registerGenerator } from './runGenerator';

export interface JsonInspectorParams {
  id?: string;
  title?: string;
  /** Any JSON-serializable value. When present it replaces the default payload. */
  data?: unknown;
}

/**
 * A believable `mesh introspect` payload: the Lattice mesh's viewer nodes, each
 * with the surfaces it exposes and the peers it talks to. Fixed key order — the
 * literal IS the canonical shape, so JSON.stringify matches the Python compact
 * json.dumps byte-for-byte.
 */
const DEFAULT_DATA: unknown = {
  mesh: 'lattice',
  captured: '2026-06-06T11:02:55Z',
  node_count: 3,
  nodes: [
    {
      id: 'viewer_session',
      kind: 'stateful',
      status: 'online',
      revision: 47,
      surfaces: [
        { name: 'session_get', io: 'read', returns: 'Session' },
        { name: 'session_set', io: 'write', accepts: 'Session' },
        { name: 'session_handoff', io: 'write', accepts: 'HandoffTarget' },
      ],
      peers: ['viewer_desktop', 'viewer_spatial'],
    },
    {
      id: 'generator_host',
      kind: 'compute',
      status: 'online',
      revision: 12,
      surfaces: [
        { name: 'generators_list', io: 'read', returns: 'GeneratorEntry[]' },
        { name: 'generator_run', io: 'invoke', accepts: 'RunRequest' },
      ],
      peers: ['viewer_session'],
    },
    {
      id: 'renderer_registry',
      kind: 'static',
      status: 'degraded',
      revision: 8,
      surfaces: [
        { name: 'renderers_list', io: 'read', returns: 'RendererEntry[]' },
        { name: 'renderer_resolve', io: 'read', returns: 'ResolvedViewData' },
      ],
      peers: ['viewer_desktop', 'viewer_spatial', 'generator_host'],
    },
  ],
};

/** Pure build: params -> exactly one json View. */
export function build(params: JsonInspectorParams = {}): View[] {
  const data = params.data ?? DEFAULT_DATA;
  // No-space stringify => byte-identical to Python json.dumps(separators=(",",":")).
  const value = JSON.stringify(data);
  const view: View = {
    id: params.id ?? 'json',
    type: 'json',
    title: params.title ?? 'Mesh Introspect',
    source: { kind: 'inline', value, mediaType: 'application/json' },
    layout: { w: 1.2, h: 0.9, hint: 'wide' },
  };
  return [view];
}

export const jsonInspectorGenerator: GeneratorEntry<JsonInspectorParams> = {
  slug: 'json_inspector',
  describe: 'Emit a collapsible json tree View (defaults to a mesh introspect payload).',
  generate: build,
};

/** Register the json_inspector generator with the shared registry. */
export function registerJsonInspectorGenerator(): void {
  registerGenerator(jsonInspectorGenerator as GeneratorEntry);
}
