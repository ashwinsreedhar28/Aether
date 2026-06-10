/**
 * raven_ops generator (TS side).
 *
 * RAVEN's own composite ops cockpit. There is no cross-language Python mirror for
 * this generator (it is agent-authored, TS-only), so instead of a hand-copied SHA
 * pin this suite asserts (a) the emitted shape — five mixed-type Views with grid
 * hints, (b) determinism — the same input serializes byte-identically across two
 * runs, and (c) that every panel carries real, type-correct content.
 */
import { describe, it, expect } from 'vitest';
import { build, ravenOpsGenerator, registerRavenOpsGenerator } from './raven_ops';
import { runGenerator, getGenerator } from './runGenerator';
import { assertView } from '../schema/validate';
import type { View } from '../schema/view';

function serialize(views: View[]): string {
  return JSON.stringify(views);
}

describe('raven_ops generator (TS)', () => {
  it('emits five valid Views of mixed type by default', () => {
    const views = runGenerator(build, {});
    expect(views.length).toBe(5);
    views.forEach((v) => assertView(v));
    expect(views.map((v) => v.type)).toEqual(['markdown', 'html', 'table', 'mermaid', 'kanban']);
    expect(views.map((v) => v.id)).toEqual([
      'raven-ops-summary',
      'raven-ops-kpis',
      'raven-ops-table',
      'raven-ops-topology',
      'raven-ops-board',
    ]);
  });

  it('every panel carries a grid placement hint in meta', () => {
    const views = build();
    views.forEach((v) => {
      expect(v.meta).toBeDefined();
      for (const k of ['gx', 'gy', 'gw', 'gh']) {
        expect(typeof (v.meta as Record<string, unknown>)[k]).toBe('number');
      }
    });
    // No two panels share the same top-left cell.
    const cells = views.map((v) => `${(v.meta as any).gx},${(v.meta as any).gy}`);
    expect(new Set(cells).size).toBe(views.length);
  });

  it('is deterministic — same input serializes byte-identically across runs', () => {
    expect(serialize(build())).toBe(serialize(build()));
    const custom = { title: 'RAVEN Nightly', accent: '#00d4aa' };
    expect(serialize(build(custom))).toBe(serialize(build(custom)));
  });

  it('panels carry real, type-correct content', () => {
    const [md, html, table, mermaid, board] = build();
    expect(md.source.value.startsWith('# RAVEN Ops')).toBe(true);
    expect(md.source.value).toContain('## Highlights');
    expect(html.source.value).toContain('grid-template-columns:repeat(3,1fr)');
    expect(html.source.value).toContain('Mesh Nodes'); // a KPI label
    expect(table.source.mediaType).toBe('text/csv');
    expect(table.source.value.split('\n')[0]).toBe('Node,Role,Status,Surfaces,p95 ms');
    expect(table.source.value).toContain('viewer_desktop');
    expect(mermaid.source.value.startsWith('graph LR')).toBe(true);
    expect(mermaid.source.value).toContain('viewer_desktop');
    const parsed = JSON.parse(board.source.value);
    expect(parsed.columns.map((c: any) => c.title)).toEqual(['Queued', 'Running', 'Done']);
  });

  it('honors custom params (override any field)', () => {
    const views = build({
      title: 'Custom Board',
      summary: 'Everything nominal.',
      highlights: ['- one line.'],
      kpis: [{ label: 'X', value: '1', delta: 'flat', good: true }],
      nodes: [{ node: 'n1', role: 'r', status: 'green', surfaces: 's', latencyMs: '9' }],
      boardName: 'My Workers',
      columns: [{ id: 'a', title: 'A', cards: [] }],
    });
    expect(views[0].title).toBe('Custom Board');
    expect(views[0].source.value).toContain('Everything nominal.');
    expect(views[2].source.value.split('\n')[1]).toBe('n1,r,green,s,9');
    expect(views[4].title).toBe('My Workers');
    const parsed = JSON.parse(views[4].source.value);
    expect(parsed.name).toBe('My Workers');
    expect(parsed.columns).toHaveLength(1);
  });

  it('registers under its slug', () => {
    registerRavenOpsGenerator();
    expect(getGenerator('raven_ops')?.slug).toBe('raven_ops');
    expect(ravenOpsGenerator.slug).toBe('raven_ops');
  });
});
