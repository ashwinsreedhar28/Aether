/**
 * Cross-language knowledge-graph generator parity (TS side).
 *
 * Runs the SHARED fixture (generators/kg-fixture.json) through the TS kg
 * `build`. The Python suite (python/generators/test_viewer_generators.py) runs
 * the SAME file through `knowledge_graph_build`. Because both read one fixture
 * and assert against `expectedView` — including the byte-exact compact
 * `source.value` JSON string — the two generators cannot drift: a shape change
 * on either side turns that side's run red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build, type KgParams } from './knowledge-graph';
import { runGenerator } from './runGenerator';
import { assertView } from '../schema/validate';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '../../generators/kg-fixture.json');

interface Fixture {
  input: KgParams;
  expectedView: unknown;
}
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('knowledge-graph generator parity (TS)', () => {
  it('emits exactly the fixture expectedView for the fixture input', () => {
    const views = build(fixture.input);
    expect(views).toHaveLength(1);
    expect(views[0]).toEqual(fixture.expectedView);
  });

  it('emits a valid View (source.value is parseable mindmap JSON)', () => {
    const [view] = runGenerator(build, fixture.input);
    assertView(view);
    const content = JSON.parse(view.source.value);
    expect(content.nodes).toHaveLength(2);
    expect(content.edges).toHaveLength(1);
  });
});
