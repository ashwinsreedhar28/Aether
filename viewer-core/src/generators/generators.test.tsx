/**
 * Generator runner + registry coverage, plus the desktop wire-up proof:
 * a generator's emitted View renders through the SHARED knowledge-graph
 * renderer (the same renderer the desktop shell mounts).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KnowledgeGraphRenderer } from '../renderers/knowledge-graph';
import type { View, ResolvedViewData } from '../schema/view';
import {
  runGenerator,
  registerGenerator,
  getGenerator,
  listGenerators,
  _resetGenerators,
} from './runGenerator';
import { build, knowledgeGraphGenerator } from './knowledge-graph';
import type { GeneratorEntry } from './types';

describe('runGenerator', () => {
  it('returns the emitted Views when they are valid', () => {
    const views = runGenerator(build, {});
    expect(views).toHaveLength(1);
    expect(views[0].type).toBe('knowledge-graph');
  });

  it('accepts a GeneratorEntry as well as a bare function', () => {
    const views = runGenerator(knowledgeGraphGenerator, {});
    expect(views[0].type).toBe('knowledge-graph');
  });

  it('throws clearly when a generator emits an invalid View', () => {
    const bad: GeneratorEntry = {
      slug: 'bad',
      describe: 'emits an invalid view',
      generate: () => [{ id: '', type: 'nope', source: { kind: 'x', value: '' } } as unknown as View],
    };
    expect(() => runGenerator(bad, {})).toThrow(/invalid View at index 0/);
  });

  it('throws when a generator returns a non-array', () => {
    const bad = (() => ({})) as unknown as () => View[];
    expect(() => runGenerator(bad, {})).toThrow(/must return an array/);
  });
});

describe('generator registry', () => {
  beforeEach(() => _resetGenerators());

  it('registers, looks up, and lists generators by slug', () => {
    registerGenerator(knowledgeGraphGenerator as GeneratorEntry);
    expect(getGenerator('knowledge-graph')?.describe).toMatch(/knowledge-graph/i);
    expect(listGenerators().map((g) => g.slug)).toContain('knowledge-graph');
  });

  it('returns undefined for an unknown slug', () => {
    expect(getGenerator('does-not-exist')).toBeUndefined();
  });
});

describe('desktop wire-up: emitted View renders via the shared kg renderer', () => {
  it('runs the generator -> resolves inline content -> renders nodes + edges', () => {
    const [view] = runGenerator(build, {});
    // The host resolves View.source into ResolvedViewData; inline => value is content.
    const data: ResolvedViewData = { content: view.source.value, isUrl: false };
    const html = renderToStaticMarkup(<KnowledgeGraphRenderer view={view} data={data} />);
    // Nodes rendered as titles; edges rendered as <line> in the SVG overlay.
    expect(html).toContain('View contract');
    expect(html).toContain('Generators');
    expect(html).toContain('<line');
    expect(html).not.toContain('Invalid graph');
    expect(html).not.toContain('Empty graph');
  });
});
