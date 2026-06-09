/**
 * The knowledge-graph generator — the proof case for the declarative path.
 *
 * A pure `build(params) -> View[]` that emits ONE `knowledge-graph` View whose
 * inline source is the EXACT JSON the shared knowledge-graph renderer parses
 * (see renderers/knowledge-graph.tsx: it reads `data.content` as a mindmap file
 * `{name?, nodes:[{id,title,position:{x,y},color?}], edges:[{id,source,target,label?}]}`).
 *
 * The content is serialized with a fixed key order and compact separators so it
 * is byte-identical to the Python mirror (python/generators/viewer_generators.py)
 * for the same input — that string identity is what the cross-language fixture
 * test pins down. Calling with no params yields a small, real demo graph.
 */
import type { View } from '../schema/view';
import type { GeneratorEntry } from './types';
import { registerGenerator } from './runGenerator';

export interface KgNode {
  id: string;
  title: string;
  position: { x: number; y: number };
  color?: string;
}
export interface KgEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}
export interface KgParams {
  id?: string;
  title?: string;
  name?: string;
  nodes?: KgNode[];
  edges?: KgEdge[];
}

const DEFAULT_NAME = 'Viewer Ecosystem';
const DEFAULT_NODES: KgNode[] = [
  { id: 'view', title: 'View contract', position: { x: 240, y: 40 }, color: '#4a9eff' },
  { id: 'desktop', title: 'viewer-desktop', position: { x: 40, y: 200 } },
  { id: 'spatial', title: 'viewer-spatial', position: { x: 440, y: 200 } },
  { id: 'renderers', title: 'Shared renderers', position: { x: 40, y: 360 } },
  { id: 'generators', title: 'Generators', position: { x: 440, y: 360 }, color: '#7bd88f' },
  { id: 'tools', title: 'Tools', position: { x: 240, y: 440 } },
];
const DEFAULT_EDGES: KgEdge[] = [
  { id: 'e1', source: 'view', target: 'desktop', label: 'renders' },
  { id: 'e2', source: 'view', target: 'spatial', label: 'renders' },
  { id: 'e3', source: 'renderers', target: 'view', label: 'draw' },
  { id: 'e4', source: 'generators', target: 'view', label: 'emit' },
  { id: 'e5', source: 'tools', target: 'view', label: 'place' },
];

/**
 * Canonicalize content into the renderer's mindmap shape with a fixed key order
 * and only the optional keys that are present. Must stay in lockstep with the
 * Python mirror's `_build_content` so `JSON.stringify` here equals
 * `json.dumps(..., separators=(",", ":"))` there.
 */
function buildContent(name: string, nodes: KgNode[], edges: KgEdge[]): Record<string, unknown> {
  return {
    name,
    nodes: nodes.map((n) => {
      const o: Record<string, unknown> = {
        id: n.id,
        title: n.title,
        position: { x: n.position.x, y: n.position.y },
      };
      if (n.color !== undefined) o.color = n.color;
      return o;
    }),
    edges: edges.map((e) => {
      const o: Record<string, unknown> = { id: e.id, source: e.source, target: e.target };
      if (e.label !== undefined) o.label = e.label;
      return o;
    }),
  };
}

/** Pure build: params -> exactly one knowledge-graph View. */
export function build(params: KgParams = {}): View[] {
  const name = params.name ?? DEFAULT_NAME;
  const nodes = params.nodes ?? DEFAULT_NODES;
  const edges = params.edges ?? DEFAULT_EDGES;
  const content = buildContent(name, nodes, edges);
  const view: View = {
    id: params.id ?? 'kg',
    type: 'knowledge-graph',
    title: params.title ?? 'Knowledge Graph',
    source: { kind: 'inline', value: JSON.stringify(content) },
    layout: { w: 1.2, h: 0.9, hint: 'wide' },
  };
  return [view];
}

export const knowledgeGraphGenerator: GeneratorEntry<KgParams> = {
  slug: 'knowledge-graph',
  describe: 'Emit a knowledge-graph View from nodes + edges (defaults to a demo graph).',
  generate: build,
};

/** Register the kg generator with the shared registry. */
export function registerKnowledgeGraphGenerator(): void {
  registerGenerator(knowledgeGraphGenerator as GeneratorEntry);
}
