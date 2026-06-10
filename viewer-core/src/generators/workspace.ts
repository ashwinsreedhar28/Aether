/**
 * The workspace generator — the headline composite demo.
 *
 * ONE generator call emits SEVERAL Views of DIFFERENT types: a whole arranged
 * multi-panel workspace, not a single panel. The default build is a live
 * "Project Cockpit" — a markdown summary, an html KPI-tile grid, a CSV
 * service-health table, a mermaid deploy pipeline, and a kanban release board.
 * An optional `theme` param swaps in a second fully-authored preset
 * ("briefing", a personal Morning Briefing) to prove a generator can author
 * distinct whole workspaces, not just one panel.
 *
 * Every panel carries a `meta` grid hint ({gx,gy,gw,gh}) so a shell can arrange
 * the panels into a real dashboard instead of stacking them. All content
 * strings are assembled deterministically (fixed key order, compact JSON
 * separators, matching CSV/HTML/markdown builders) so the full emitted View[]
 * serializes byte-identically to the Python mirror
 * (python/generators/workspace.py) for the same input — that string identity is
 * what the cross-language parity test pins down.
 */
import type { View } from '../schema/view';
import type { GeneratorEntry } from './types';
import { registerGenerator } from './runGenerator';

export interface KpiTile {
  label: string;
  value: string;
  delta: string;
  good: boolean;
}
export interface BoardCard {
  id: string;
  title: string;
  description: string;
  tags: string[];
}
export interface BoardColumn {
  id: string;
  title: string;
  cards: BoardCard[];
}
export interface WorkspaceTheme {
  label: string;
  subtitle: string;
  accent: string;
  summary: string;
  highlights: string[];
  kpis: KpiTile[];
  table_title: string;
  table_header: string[];
  table_rows: string[][];
  flow_title: string;
  mermaid: string;
  board: { name: string; columns: BoardColumn[] };
}
export interface WorkspaceParams {
  theme?: string;
}

// --- preset content (two fully-authored workspaces) ------------------------

export const THEMES: Record<string, WorkspaceTheme> = {
  cockpit: {
    label: 'Project Cockpit',
    subtitle: 'Atlas Platform - Release 4.7 - Live Mission Control',
    accent: '#4a9eff',
    summary:
      "Release 4.7 is 82% complete and tracking green for Friday's cut. Two epics remain in review and there are no open Sev-1s. Burn-down is a full day ahead of plan.",
    highlights: [
      '- **4 of 5 epics** merged to `release/4.7`; spatial-handoff is in final review.',
      '- **p95 latency** across the mesh holds at **138 ms** against a 200 ms budget.',
      '- **Zero** open Sev-1s for nine days running.',
    ],
    kpis: [
      { label: 'Sprint Progress', value: '82%', delta: '+6% vs plan', good: true },
      { label: 'Open Bugs', value: '14', delta: '-5 this week', good: true },
      { label: 'p95 Latency', value: '138 ms', delta: '-12 ms', good: true },
      { label: 'CI Pass Rate', value: '96.4%', delta: '+1.2%', good: true },
      { label: 'Cloud Spend', value: '$23.1k', delta: '+$1.4k', good: false },
      { label: 'Days to Cut', value: '2', delta: 'on track', good: true },
    ],
    table_title: 'Service Health',
    table_header: ['Service', 'Owner', 'Status', 'Uptime', 'p95 ms'],
    table_rows: [
      ['mesh-gateway', 'Priya', 'green', '99.98%', '132'],
      ['viewer-spatial', 'Marcus', 'green', '99.95%', '145'],
      ['viewer-desktop', 'Lena', 'green', '99.99%', '88'],
      ['auth-edge', 'Sam', 'amber', '99.90%', '210'],
      ['telemetry', 'Dana', 'green', '99.97%', '118'],
    ],
    flow_title: 'Deploy Pipeline',
    mermaid:
      'graph LR\n  A[Commit] --> B[CI Build]\n  B --> C{Tests}\n  C -->|pass| D[Stage]\n  C -->|fail| A\n  D --> E[Canary 5%]\n  E --> F[Release 4.7]',
    board: {
      name: 'Release 4.7 Board',
      columns: [
        {
          id: 'bk',
          title: 'Backlog',
          cards: [
            { id: 'c1', title: 'Offline session cache', description: 'Persist views for handoff', tags: ['spatial', 'P2'] },
            { id: 'c2', title: 'Theme tokens', description: 'Shared accent palette', tags: ['desktop'] },
          ],
        },
        {
          id: 'ip',
          title: 'In Progress',
          cards: [
            { id: 'c3', title: 'Spatial handoff epic', description: 'Move workspace desktop -> AVP', tags: ['epic', 'P1'] },
          ],
        },
        {
          id: 'rv',
          title: 'Review',
          cards: [
            { id: 'c4', title: 'Mermaid renderer perf', description: 'Cache parsed graphs', tags: ['perf'] },
          ],
        },
        {
          id: 'dn',
          title: 'Done',
          cards: [
            { id: 'c5', title: 'CSV table sort', description: 'Click-to-sort columns', tags: ['desktop'] },
            { id: 'c6', title: 'KPI tiles', description: 'Metric grid html view', tags: ['spatial'] },
          ],
        },
      ],
    },
  },
  briefing: {
    label: 'Morning Briefing',
    subtitle: 'Tuesday, 6 Jun 2026 - Personal Command Center',
    accent: '#f0a830',
    summary:
      "Six meetings today with a two-hour focus block protected at 14:00. Inbox is at 12 unread, three flagged. Travel for Thursday's offsite is booked and confirmed.",
    highlights: [
      '- **Focus block** 14:00-16:00 held for the Q3 roadmap draft.',
      '- **3 flagged** emails need replies before noon.',
      '- **Gym + reading** streak at **18 days**; keep it alive.',
    ],
    kpis: [
      { label: 'Meetings Today', value: '6', delta: '2 back-to-back', good: false },
      { label: 'Inbox Unread', value: '12', delta: '-8 since 7am', good: true },
      { label: 'Focus Hours', value: '2.0', delta: 'protected', good: true },
      { label: 'Steps', value: '3,480', delta: 'behind pace', good: false },
      { label: 'Tasks Due', value: '5', delta: '2 overdue', good: false },
      { label: 'Streak (days)', value: '18', delta: '+1', good: true },
    ],
    table_title: "Today's Schedule",
    table_header: ['Time', 'Event', 'With', 'Where', 'Prep'],
    table_rows: [
      ['09:00', 'Standup', 'Platform team', 'Zoom', 'none'],
      ['10:30', '1:1 with Priya', 'Priya', 'Room 4', 'notes'],
      ['12:00', 'Lunch + walk', '-', 'Outside', '-'],
      ['14:00', 'Focus: Q3 roadmap', '-', 'Desk', 'deck'],
      ['16:30', 'Design review', 'Design guild', 'AVP space', 'figma'],
    ],
    flow_title: 'Day Flow',
    mermaid:
      'graph TD\n  M[Morning] --> S[Standup]\n  S --> O[1:1s]\n  O --> L[Lunch + Walk]\n  L --> F[Focus Block]\n  F --> R[Design Review]\n  R --> W[Wrap-up]',
    board: {
      name: 'Today',
      columns: [
        {
          id: 'td',
          title: 'To Do',
          cards: [
            { id: 't1', title: 'Reply to flagged email', description: '3 threads waiting', tags: ['inbox'] },
            { id: 't2', title: 'Book dentist', description: 'Overdue 2 days', tags: ['personal', 'overdue'] },
          ],
        },
        {
          id: 'dg',
          title: 'Doing',
          cards: [
            { id: 't3', title: 'Q3 roadmap draft', description: 'Focus block 14:00', tags: ['deep-work'] },
          ],
        },
        {
          id: 'dn',
          title: 'Done',
          cards: [
            { id: 't4', title: 'Standup', description: 'Shared blockers', tags: ['team'] },
            { id: 't5', title: 'Morning workout', description: 'Day 18 streak', tags: ['health'] },
          ],
        },
      ],
    },
  },
};

const DEFAULT_THEME = 'cockpit';

// Grid placement (4-wide dashboard): summary|kpis / table|mermaid / board-full.
const GRID: Array<Record<string, number>> = [
  { gx: 0, gy: 0, gw: 2, gh: 1 },
  { gx: 2, gy: 0, gw: 2, gh: 1 },
  { gx: 0, gy: 1, gw: 2, gh: 1 },
  { gx: 2, gy: 1, gw: 2, gh: 1 },
  { gx: 0, gy: 2, gw: 4, gh: 1 },
];
const LAYOUT: Array<{ w: number; h: number; hint: 'wide' | 'tall' }> = [
  { w: 1.4, h: 0.8, hint: 'wide' },
  { w: 1.4, h: 0.8, hint: 'wide' },
  { w: 1.4, h: 0.8, hint: 'wide' },
  { w: 1.4, h: 0.8, hint: 'tall' },
  { w: 2.8, h: 0.9, hint: 'wide' },
];

/** Quote a field only when it contains a comma, quote, or newline (RFC 4180). */
function escapeCsvField(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}

/** CSV with fixed row/column order. Must match the Python `_to_csv`. */
function toCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((r) => r.map(escapeCsvField).join(','));
  return lines.join('\n');
}

/** Markdown summary block. Must match the Python `_summary_md`. */
function summaryMd(label: string, subtitle: string, summary: string, highlights: string[]): string {
  const blocks = [`# ${label}`, `_${subtitle}_`, `> ${summary}`, '## Highlights\n\n' + highlights.join('\n')];
  return blocks.join('\n\n');
}

/** A self-contained KPI-tile grid as an HTML string. Must match the Python `_kpi_html`. */
function kpiHtml(label: string, accent: string, tiles: KpiTile[]): string {
  const head =
    '<div style="font-family:-apple-system,system-ui,sans-serif;' +
    'padding:20px;background:#0f1117;color:#e6e6e6">' +
    `<h2 style="margin:0 0 16px;color:${accent}">${label} - Key Metrics</h2>` +
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">';
  const cells = tiles.map((t) => {
    const color = t.good ? '#7bd88f' : '#ff6b6b';
    return (
      '<div style="background:#1a1d27;border-radius:12px;padding:16px;' +
      `border-left:3px solid ${accent}">` +
      '<div style="font-size:12px;color:#8b8f9a;text-transform:uppercase;' +
      `letter-spacing:.05em">${t.label}</div>` +
      `<div style="font-size:28px;font-weight:700;margin:6px 0">${t.value}</div>` +
      `<div style="font-size:13px;color:${color}">${t.delta}</div>` +
      '</div>'
    );
  });
  return head + cells.join('') + '</div></div>';
}

/** Canonical kanban content: fixed key order, compact JSON. Must match Python `_board_content`. */
function boardContent(board: WorkspaceTheme['board']): string {
  const obj = {
    name: board.name,
    columns: board.columns.map((c) => ({
      id: c.id,
      title: c.title,
      cards: c.cards.map((card) => ({
        id: card.id,
        title: card.title,
        description: card.description,
        tags: card.tags,
      })),
    })),
  };
  return JSON.stringify(obj);
}

/** Pure build: params -> several Views of mixed type (a whole workspace). */
export function build(params: WorkspaceParams = {}): View[] {
  const theme = params.theme || DEFAULT_THEME;
  const key = theme in THEMES ? theme : DEFAULT_THEME;
  const p = THEMES[key];

  const summary = summaryMd(p.label, p.subtitle, p.summary, p.highlights);
  const kpis = kpiHtml(p.label, p.accent, p.kpis);
  const csv = toCsv(p.table_header, p.table_rows);
  const mermaid = p.mermaid;
  const board = boardContent(p.board);

  return [
    {
      id: `${key}-summary`,
      type: 'markdown',
      title: p.label,
      source: { kind: 'inline', value: summary },
      layout: LAYOUT[0],
      meta: GRID[0],
    },
    {
      id: `${key}-kpis`,
      type: 'html',
      title: 'Key Metrics',
      source: { kind: 'inline', value: kpis },
      layout: LAYOUT[1],
      meta: GRID[1],
    },
    {
      id: `${key}-table`,
      type: 'table',
      title: p.table_title,
      source: { kind: 'inline', value: csv, mediaType: 'text/csv' },
      layout: LAYOUT[2],
      meta: GRID[2],
    },
    {
      id: `${key}-flow`,
      type: 'mermaid',
      title: p.flow_title,
      source: { kind: 'inline', value: mermaid },
      layout: LAYOUT[3],
      meta: GRID[3],
    },
    {
      id: `${key}-board`,
      type: 'kanban',
      title: p.board.name,
      source: { kind: 'inline', value: board },
      layout: LAYOUT[4],
      meta: GRID[4],
    },
  ];
}

export const workspaceGenerator: GeneratorEntry<WorkspaceParams> = {
  slug: 'workspace',
  describe:
    'Emit a whole arranged multi-panel workspace (markdown+html+table+mermaid+kanban); theme defaults to a live Project Cockpit.',
  generate: build,
};

/** Register the workspace generator with the shared registry. */
export function registerWorkspaceGenerator(): void {
  registerGenerator(workspaceGenerator as GeneratorEntry);
}
