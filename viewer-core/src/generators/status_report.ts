/**
 * The status_report generator — the proof case for prose-heavy Views.
 *
 * A pure `build(params) -> View[]` that emits ONE `markdown` View whose inline
 * source is a rich, structured briefing (headers, a table, bullet + numbered
 * lists, bold/emphasis, a blockquote). The shared markdown renderer
 * (renderers/markdown.tsx) reads `data.content` as GitHub-flavored markdown, so
 * the document below is exactly what an exec sees in either shell.
 *
 * The markdown string is assembled from blocks joined by a fixed separator so it
 * is byte-identical to the Python mirror (python/generators/status_report.py)
 * for the same input. Calling with no params yields a full Daily Ops Briefing.
 */
import type { View } from '../schema/view';
import type { GeneratorEntry } from './types';
import { registerGenerator } from './runGenerator';

export interface ReportSection {
  heading: string;
  body: string;
}
export interface StatusReportParams {
  id?: string;
  title?: string;
  subtitle?: string;
  summary?: string;
  sections?: ReportSection[];
}

const DEFAULT_TITLE = 'Daily Ops Briefing';
const DEFAULT_SUBTITLE = 'Engineering Status - Cycle 24, Day 3 - Prepared by Platform On-Call';
const DEFAULT_SUMMARY =
  'All primary services green. One Sev-2 (checkout latency) was resolved overnight; root cause was a stale connection pool. The v2.14 release train remains on schedule for Friday.';
const DEFAULT_SECTIONS: ReportSection[] = [
  {
    heading: 'Key Metrics',
    body: [
      '| Metric | Today | 7-day avg | Trend |',
      '| --- | --- | --- | --- |',
      '| Uptime (core API) | 99.98% | 99.95% | up |',
      '| p95 latency | 142 ms | 168 ms | improving |',
      '| Error rate | 0.04% | 0.06% | improving |',
      '| Deploys shipped | 11 | 8 | up |',
      '| Open Sev-1 / Sev-2 | 0 / 1 | 0 / 2 | improving |',
    ].join('\n'),
  },
  {
    heading: 'Highlights',
    body: [
      '- **Checkout latency Sev-2 resolved** at 03:12 UTC. The fix shipped in `hotfix/pool-recycle` and added a connection-pool recycler.',
      '- **Search relevance** rollout reached 50% of traffic; click-through is up **6.2%** versus control.',
      '- **Cost**: the spot-instance migration cut nightly batch spend by roughly **$1,840/week**.',
    ].join('\n'),
  },
  {
    heading: 'Risks & Blockers',
    body: [
      '- **Postgres primary** is approaching 78% disk. A failover drill is scheduled before Thursday.',
      '- The vendor TLS certificate for `payments-gw` expires in **6 days**; the renewal PR is awaiting approval.',
      '- The iOS build pipeline is flaky (2 of 9 runs failed at the signing step) and is under investigation.',
    ].join('\n'),
  },
  {
    heading: 'Next 24 Hours',
    body: [
      '1. Promote the search rollout to 100% pending a final relevance review.',
      '2. Run the Postgres failover drill and reclaim disk on the primary.',
      '3. Merge the `payments-gw` certificate renewal and verify the handshake in staging.',
      '4. Cut the v2.14 release branch and freeze non-critical merges.',
    ].join('\n'),
  },
];

/**
 * Assemble the markdown document from ordered blocks joined by a blank line.
 * Must stay in lockstep with the Python mirror's `_build_markdown` so the
 * resulting string is identical byte-for-byte.
 */
function buildMarkdown(
  title: string,
  subtitle: string | undefined,
  summary: string | undefined,
  sections: ReportSection[]
): string {
  const blocks: string[] = [`# ${title}`];
  if (subtitle !== undefined) blocks.push(`_${subtitle}_`);
  if (summary !== undefined) blocks.push(`> ${summary}`);
  for (const s of sections) blocks.push(`## ${s.heading}\n\n${s.body}`);
  return blocks.join('\n\n');
}

/** Pure build: params -> exactly one markdown View. */
export function build(params: StatusReportParams = {}): View[] {
  const title = params.title ?? DEFAULT_TITLE;
  const subtitle = params.subtitle ?? DEFAULT_SUBTITLE;
  const summary = params.summary ?? DEFAULT_SUMMARY;
  const sections = params.sections ?? DEFAULT_SECTIONS;
  const content = buildMarkdown(title, subtitle, summary, sections);
  const view: View = {
    id: params.id ?? 'status',
    type: 'markdown',
    title: params.title ?? DEFAULT_TITLE,
    source: { kind: 'inline', value: content },
    layout: { w: 0.8, h: 1, hint: 'tall' },
  };
  return [view];
}

export const statusReportGenerator: GeneratorEntry<StatusReportParams> = {
  slug: 'status_report',
  describe: 'Emit a markdown status/briefing View (defaults to a full Daily Ops Briefing).',
  generate: build,
};

/** Register the status_report generator with the shared registry. */
export function registerStatusReportGenerator(): void {
  registerGenerator(statusReportGenerator as GeneratorEntry);
}
