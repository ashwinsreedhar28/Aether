/**
 * json_inspector generator coverage + cross-language parity (TS side).
 *
 * The EXPECTED_JSON constant below is byte-identical to the one pinned in the
 * Python suite (python/generators/test_json_inspector.py). Both sides assert
 * their generator's `source.value` equals this exact string, so the two
 * generators cannot drift: a shape change on either side turns that side red.
 */
import { describe, it, expect } from 'vitest';
import { build, jsonInspectorGenerator } from './json_inspector';
import { runGenerator } from './runGenerator';
import { assertView } from '../schema/validate';

// Byte-exact mirror of the Python EXPECTED_JSON. The parity contract lives here.
const EXPECTED_JSON =
  '{"mesh":"lattice","captured":"2026-06-06T11:02:55Z","node_count":3,"nodes":[' +
  '{"id":"viewer_session","kind":"stateful","status":"online","revision":47,' +
  '"surfaces":[{"name":"session_get","io":"read","returns":"Session"},' +
  '{"name":"session_set","io":"write","accepts":"Session"},' +
  '{"name":"session_handoff","io":"write","accepts":"HandoffTarget"}],' +
  '"peers":["viewer_desktop","viewer_spatial"]},' +
  '{"id":"generator_host","kind":"compute","status":"online","revision":12,' +
  '"surfaces":[{"name":"generators_list","io":"read","returns":"GeneratorEntry[]"},' +
  '{"name":"generator_run","io":"invoke","accepts":"RunRequest"}],' +
  '"peers":["viewer_session"]},' +
  '{"id":"renderer_registry","kind":"static","status":"degraded","revision":8,' +
  '"surfaces":[{"name":"renderers_list","io":"read","returns":"RendererEntry[]"},' +
  '{"name":"renderer_resolve","io":"read","returns":"ResolvedViewData"}],' +
  '"peers":["viewer_desktop","viewer_spatial","generator_host"]}]}';

describe('json_inspector generator', () => {
  it('default emits exactly one valid json View', () => {
    const views = runGenerator(build, {});
    expect(views).toHaveLength(1);
    const [view] = views;
    assertView(view);
    expect(view.type).toBe('json');
    expect(view.id).toBe('json');
    expect(view.title).toBe('Mesh Introspect');
    expect(view.source.kind).toBe('inline');
    expect(view.source.mediaType).toBe('application/json');
  });

  it('default content is byte-exact JSON (cross-language parity pin)', () => {
    const [view] = build();
    expect(view.source.value).toBe(EXPECTED_JSON);
  });

  it('default value parses to a populated mesh payload (3 nodes, each with surfaces)', () => {
    const parsed = JSON.parse(build()[0].source.value);
    expect(parsed.mesh).toBe('lattice');
    expect(parsed.node_count).toBe(3);
    expect(parsed.nodes).toHaveLength(3);
    for (const node of parsed.nodes) {
      expect(typeof node.id).toBe('string');
      expect(Array.isArray(node.surfaces)).toBe(true);
      expect(node.surfaces.length).toBeGreaterThan(0);
    }
  });

  it('serializes a supplied data value compactly (no spaces)', () => {
    const [view] = build({ data: { a: 1, b: [2, 3] }, title: 'Custom' });
    expect(view.source.value).toBe('{"a":1,"b":[2,3]}');
    expect(view.title).toBe('Custom');
  });

  it('exposes a registry entry with the json_inspector slug', () => {
    expect(jsonInspectorGenerator.slug).toBe('json_inspector');
    expect(typeof jsonInspectorGenerator.generate).toBe('function');
  });

  it('allows id and title overrides', () => {
    const [view] = build({ id: 'inspect1', title: 'Snapshot' });
    expect(view.id).toBe('inspect1');
    expect(view.title).toBe('Snapshot');
  });
});
