/**
 * flow_diagram generator coverage + cross-language parity pin (TS side).
 *
 * EXPECTED_DIAGRAM below is the byte-exact default Mermaid source. The Python
 * suite (python/generators/test_flow_diagram.py) pins the SAME literal. Both
 * generators must emit it verbatim, so the TS and Python sides cannot drift:
 * a change to the diagram on either side reds out that side's run.
 */
import { describe, it, expect } from 'vitest';
import { build, flowDiagramGenerator } from './flow_diagram';
import { runGenerator } from './runGenerator';
import { assertView } from '../schema/validate';

// Byte-identical to python/generators/test_flow_diagram.py::EXPECTED_DIAGRAM.
const EXPECTED_DIAGRAM = [
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
].join('\n');

describe('flow_diagram generator', () => {
  it('default build emits exactly one mermaid View with the ecosystem diagram', () => {
    const views = build();
    expect(views).toHaveLength(1);
    expect(views[0]).toEqual({
      id: 'flow',
      type: 'mermaid',
      title: 'Viewer Ecosystem Flow',
      source: { kind: 'inline', value: EXPECTED_DIAGRAM },
      layout: { w: 1.4, h: 0.95, hint: 'wide' },
    });
  });

  it('default source.value is byte-exact Mermaid (cross-language parity pin)', () => {
    expect(build()[0].source.value).toBe(EXPECTED_DIAGRAM);
  });

  it('emits a valid View', () => {
    const [view] = runGenerator(build, {});
    expect(() => assertView(view)).not.toThrow();
    expect(view.type).toBe('mermaid');
    expect(view.source.value).toContain('graph TD');
  });

  it('honors id / title / diagram overrides', () => {
    const [view] = build({ id: 'x', title: 'Custom', diagram: 'graph LR\nA-->B' });
    expect(view.id).toBe('x');
    expect(view.title).toBe('Custom');
    expect(view.source.value).toBe('graph LR\nA-->B');
  });

  it('entry exposes slug + a generate that runs through runGenerator', () => {
    expect(flowDiagramGenerator.slug).toBe('flow_diagram');
    const [view] = runGenerator(flowDiagramGenerator, {});
    expect(view.type).toBe('mermaid');
  });
});
