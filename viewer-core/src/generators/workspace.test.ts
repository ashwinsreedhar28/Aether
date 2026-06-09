/**
 * workspace generator (TS side) + cross-language parity pins.
 *
 * The default cockpit and the alternate briefing workspaces are deterministic,
 * so the byte-exact SHA-256 of the WHOLE emitted View[] (compact-serialized) is
 * a stable contract. The Python suite (python/generators/test_workspace.py)
 * asserts the SAME two hashes. One constant per theme, two readers: if either
 * side's content drifts by a single byte, that side turns red.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { build, workspaceGenerator, registerWorkspaceGenerator } from './workspace';
import { runGenerator, getGenerator } from './runGenerator';
import { assertView } from '../schema/validate';
import type { View } from '../schema/view';

// Byte-exact SHA-256 of JSON.stringify(views) per theme. Must equal the Python pins.
const COCKPIT_SHA = '0c8baf3e0e558ece57fd987765a3b396bd222ef63469e55a6e0a04b2d4c9dcb9';
const BRIEFING_SHA = 'e1c9e1305dfda537d5c5b1619ca7c1e7dd827efdcd82fc8a77f9349410884a04';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
function serialize(views: View[]): string {
  return JSON.stringify(views);
}

describe('workspace generator (TS)', () => {
  it('emits five valid Views of mixed type by default', () => {
    const views = runGenerator(build, {});
    expect(views.length).toBe(5);
    views.forEach((v) => assertView(v));
    expect(views.map((v) => v.type)).toEqual(['markdown', 'html', 'table', 'mermaid', 'kanban']);
    expect(views.map((v) => v.id)).toEqual([
      'cockpit-summary',
      'cockpit-kpis',
      'cockpit-table',
      'cockpit-flow',
      'cockpit-board',
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
    // No two panels share the same top-left cell (they don't fully overlap).
    const cells = views.map((v) => `${(v.meta as any).gx},${(v.meta as any).gy}`);
    expect(new Set(cells).size).toBe(views.length);
  });

  it('default cockpit is byte-identical to the Python mirror (SHA pin)', () => {
    expect(sha256(serialize(build()))).toBe(COCKPIT_SHA);
  });

  it('briefing theme is byte-identical to the Python mirror (SHA pin)', () => {
    expect(sha256(serialize(build({ theme: 'briefing' })))).toBe(BRIEFING_SHA);
  });

  it('unknown theme falls back to the default cockpit', () => {
    expect(sha256(serialize(build({ theme: 'nonsense' })))).toBe(COCKPIT_SHA);
  });

  it('panels carry real, type-correct content', () => {
    const [md, html, table, mermaid, board] = build();
    expect(md.source.value.startsWith('# Project Cockpit')).toBe(true);
    expect(md.source.value).toContain('## Highlights');
    expect(html.source.value).toContain('grid-template-columns:repeat(3,1fr)');
    expect(html.source.value).toContain('82%'); // a KPI value
    expect(table.source.mediaType).toBe('text/csv');
    expect(table.source.value.split('\n')[0]).toBe('Service,Owner,Status,Uptime,p95 ms');
    expect(mermaid.source.value.startsWith('graph LR')).toBe(true);
    const parsed = JSON.parse(board.source.value);
    expect(parsed.columns.map((c: any) => c.title)).toEqual(['Backlog', 'In Progress', 'Review', 'Done']);
  });

  it('registers under its slug', () => {
    registerWorkspaceGenerator();
    expect(getGenerator('workspace')?.slug).toBe('workspace');
    expect(workspaceGenerator.slug).toBe('workspace');
  });
});
