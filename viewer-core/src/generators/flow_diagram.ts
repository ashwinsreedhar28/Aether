/**
 * The flow_diagram generator — the mermaid archetype for the declarative path.
 *
 * A pure `build(params) -> View[]` that emits ONE `mermaid` View whose inline
 * source is raw Mermaid diagram text (see renderers/mermaid.tsx: it reads
 * `data.content` straight as Mermaid source and renders it to SVG). Unlike the
 * knowledge-graph generator there is no JSON envelope — `source.value` IS the
 * diagram string, so TS/Python parity is just an identical constant.
 *
 * The default diagram documents the viewer ecosystem itself: an agent authors a
 * generator, the generator emits a View, the View is validated, and the SAME
 * validated View renders through shared renderers on both the desktop (Electron)
 * and spatial (Vision Pro) shells. It doubles as living documentation.
 *
 * The default text is assembled by joining a fixed line array with "\n" so the
 * Python mirror (python/generators/flow_diagram.py) produces a byte-identical
 * string for the same params. Calling with no params yields the ecosystem flow.
 */
import type { View } from '../schema/view';
import type { GeneratorEntry } from './types';
import { registerGenerator } from './runGenerator';

export interface FlowDiagramParams {
  id?: string;
  title?: string;
  diagram?: string;
}

const DEFAULT_TITLE = 'Viewer Ecosystem Flow';

/**
 * Default Mermaid source as a fixed line array. Joined with "\n" to form the
 * diagram string. Must stay byte-identical to the Python mirror's
 * DEFAULT_DIAGRAM_LINES so the emitted source.value matches across languages.
 * ASCII-only on purpose — keeps the two serializations encoding-agnostic.
 */
const DEFAULT_DIAGRAM_LINES: string[] = [
  'graph TD',
  '  subgraph Authoring',
  '    A["Agent (TS or Python)"]',
  '    G["Generator: build(params) -> View[]"]',
  '  end',
  '  subgraph Contract',
  '    V["View {id, type, source, layout}"]',
  '    R["runGenerator / assert_view"]',
  '  end',
  '  subgraph Shells',
  '    D["viewer-desktop (Electron window)"]',
  '    S["viewer-spatial (Vision Pro panel)"]',
  '  end',
  '  RND["Shared renderers"]',
  '  A -->|authors| G',
  '  G -->|emits| V',
  '  V -->|validated by| R',
  '  R -->|valid Views| D',
  '  R -->|valid Views| S',
  '  RND -->|draw| D',
  '  RND -->|draw| S',
  '  V -.->|same JSON, two surfaces| RND',
];
const DEFAULT_DIAGRAM = DEFAULT_DIAGRAM_LINES.join('\n');

/** Pure build: params -> exactly one mermaid View. */
export function build(params: FlowDiagramParams = {}): View[] {
  const diagram = params.diagram ?? DEFAULT_DIAGRAM;
  const view: View = {
    id: params.id ?? 'flow',
    type: 'mermaid',
    title: params.title ?? DEFAULT_TITLE,
    source: { kind: 'inline', value: diagram },
    layout: { w: 1.4, h: 0.95, hint: 'wide' },
  };
  return [view];
}

export const flowDiagramGenerator: GeneratorEntry<FlowDiagramParams> = {
  slug: 'flow_diagram',
  describe: 'Emit a mermaid View (defaults to the viewer ecosystem flow diagram).',
  generate: build,
};

/** Register the flow_diagram generator with the shared registry. */
export function registerFlowDiagramGenerator(): void {
  registerGenerator(flowDiagramGenerator as GeneratorEntry);
}
