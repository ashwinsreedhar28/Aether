/**
 * metric_tiles generator (TS side) + cross-language parity pin.
 *
 * The default dashboard HTML is deterministic, so its byte-exact SHA-256 is a
 * stable contract. The Python suite (python/generators/test_metric_tiles.py)
 * asserts the SAME hash against `metric_tiles_build`. One constant, two readers:
 * if either side's HTML drifts by a single byte, that side turns red.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { build, metricTilesGenerator, registerMetricTilesGenerator } from './metric_tiles';
import { runGenerator, getGenerator } from './runGenerator';
import { assertView } from '../schema/validate';

// Byte-exact SHA-256 of the default dashboard's source.value. Must equal the Python pin.
const DEFAULT_SHA = '96d5f123acecbb056c6a8deb61f95768c3dda7ad1dea89284037f65242f826c2';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

describe('metric_tiles generator (TS)', () => {
  it('emits one valid html View by default', () => {
    const [view] = runGenerator(build, {});
    assertView(view);
    expect(view.type).toBe('html');
    expect(view.id).toBe('metrics');
    expect(view.title).toBe('Product Metrics');
    expect(view.source.kind).toBe('inline');
    expect(view.layout).toEqual({ w: 1.2, h: 0.8, hint: 'wide' });
  });

  it('default dashboard is byte-identical to the Python mirror (SHA pin)', () => {
    const [view] = build();
    expect(sha256(view.source.value)).toBe(DEFAULT_SHA);
  });

  it('default dashboard is a real, self-contained KPI panel', () => {
    const html = build()[0].source.value;
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.endsWith('</html>')).toBe(true);
    expect(html).toContain('<title>Product Metrics</title>');
    expect(html).toContain('8 live metrics'); // eight default tiles
    expect(html).toContain('Monthly Revenue');
    expect(html).toContain('$1.24M');
    expect(html).toContain('tile__delta--up'); // positive trend styling
    expect(html).toContain('tile__delta--down'); // negative trend styling
    // Fully self-contained: no external resources or scripts.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  it('classifies deltas by leading glyph and escapes content', () => {
    const [view] = build({
      title: 'Ops & "Live"',
      tiles: [
        { label: 'Errors', value: '0.04%', delta: '↓ 0.02%' },
        { label: 'Latency', value: '142 ms', delta: '→ flat' },
        { label: 'No delta', value: '7' },
      ],
    });
    const html = view.source.value;
    expect(html).toContain('<title>Ops &amp; &quot;Live&quot;</title>'); // escaped
    expect(html).toContain('tile__delta--down');
    expect(html).toContain('tile__delta--flat');
    expect(html).toContain('3 live metrics');
    // The third tile has no delta -> no delta div for it.
    expect((html.match(/tile__delta /g) ?? []).length).toBe(2);
  });

  it('honors custom id/title', () => {
    const [view] = build({ id: 'kpis', title: 'Q3 KPIs', tiles: [{ label: 'A', value: '1' }] });
    expect(view.id).toBe('kpis');
    expect(view.title).toBe('Q3 KPIs');
    expect(view.source.value).toContain('<h1 class="dash__title">Q3 KPIs</h1>');
  });

  it('registers under its slug', () => {
    registerMetricTilesGenerator();
    expect(getGenerator('metric_tiles')?.slug).toBe('metric_tiles');
    expect(metricTilesGenerator.slug).toBe('metric_tiles');
  });
});
