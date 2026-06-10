/**
 * status_report generator (TS side) + cross-language parity pin.
 *
 * The default markdown document is deterministic, so its byte-exact SHA-256 is a
 * stable contract. The Python suite (python/generators/test_status_report.py)
 * asserts the SAME hash against `status_report_build`. One constant, two readers:
 * if either side's markdown drifts by a single byte, that side turns red.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { build, statusReportGenerator, registerStatusReportGenerator } from './status_report';
import { runGenerator, getGenerator } from './runGenerator';
import { assertView } from '../schema/validate';

// Byte-exact SHA-256 of the default report's source.value. Must equal the Python pin.
const DEFAULT_SHA = 'd35b2a13faef2c8aa52eb48b319468aeecdd8efe24a283df2fbb217c9e6a1de2';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

describe('status_report generator (TS)', () => {
  it('emits one valid markdown View by default', () => {
    const [view] = runGenerator(build, {});
    assertView(view);
    expect(view.type).toBe('markdown');
    expect(view.id).toBe('status');
    expect(view.title).toBe('Daily Ops Briefing');
    expect(view.source.kind).toBe('inline');
    expect(view.layout).toEqual({ w: 0.8, h: 1, hint: 'tall' });
  });

  it('default document is byte-identical to the Python mirror (SHA pin)', () => {
    const [view] = build();
    expect(sha256(view.source.value)).toBe(DEFAULT_SHA);
  });

  it('default document is a real, structured report', () => {
    const md = build()[0].source.value;
    expect(md.startsWith('# Daily Ops Briefing')).toBe(true);
    expect(md).toContain('| Metric | Today | 7-day avg | Trend |'); // a table
    expect(md).toContain('> All primary services green.'); // a blockquote
    expect(md).toContain('**Checkout latency Sev-2 resolved**'); // bold
    expect(md).toContain('## Next 24 Hours'); // multiple sections
    expect(md).toContain('1. Promote the search rollout'); // numbered list
  });

  it('honors custom params', () => {
    const [view] = build({
      id: 'q3',
      title: 'Q3 Review',
      subtitle: 'Board edition',
      summary: 'Strong quarter.',
      sections: [{ heading: 'Revenue', body: '- Up **12%** YoY.' }],
    });
    expect(view.id).toBe('q3');
    expect(view.title).toBe('Q3 Review');
    expect(view.source.value).toBe(
      '# Q3 Review\n\n_Board edition_\n\n> Strong quarter.\n\n## Revenue\n\n- Up **12%** YoY.'
    );
  });

  it('omits subtitle/summary blocks when explicitly undefined-less custom set', () => {
    const [view] = build({ subtitle: undefined, summary: undefined });
    // undefined falls back to defaults (not dropped), so both blocks present.
    expect(view.source.value).toContain('_Engineering Status');
    expect(view.source.value).toContain('> All primary services green.');
  });

  it('registers under its slug', () => {
    registerStatusReportGenerator();
    expect(getGenerator('status_report')?.slug).toBe('status_report');
    expect(statusReportGenerator.slug).toBe('status_report');
  });
});
