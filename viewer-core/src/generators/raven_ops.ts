/**
 * The raven_ops generator — RAVEN's own live operations cockpit.
 *
 * The first generator authored BY the agent (RAVEN) rather than shipped with the
 * demo slate. ONE call emits FIVE Views of different types describing RAVEN's
 * runtime: a markdown system summary, an html KPI-tile grid, a CSV mesh-node
 * health table, a mermaid mesh-topology diagram, and a kanban worker board
 * (queued / running / done). It mirrors the `workspace` generator's composite
 * shape — same grid placement, same deterministic builders — so the full slate
 * of View types renders identically across the desktop and spatial shells from a
 * generator RAVEN wrote and pushed.
 *
 * Pure `params -> View[]`: callers may override any field, but the defaults paint
 * a complete, self-describing RAVEN ops board. All content strings are assembled
 * deterministically (fixed key order, compact JSON separators, matching
 * CSV/HTML/markdown builders) so the same input serializes byte-identically every
 * run — which is what the self-contained test pins down.
 */
import type { View } from '../schema/view';
import type { GeneratorEntry } from './types';
import { registerGenerator } from './runGenerator';

export interface OpsKpi {
  label: string;
  value: string;
  delta: string;
  good: boolean;
}
export interface MeshNodeRow {
  node: string;
  role: string;
  status: string;
  surfaces: string;
  latencyMs: string;
}
export interface WorkerCard {
  id: string;
  title: string;
  detail: string;
  tags: string[];
}
export interface WorkerColumn {
  id: string;
  title: string;
  cards: WorkerCard[];
}
export interface RavenOpsParams {
  title?: string;
  subtitle?: string;
  accent?: string;
  summary?: string;
  highlights?: string[];
  kpis?: OpsKpi[];
  tableTitle?: string;
  nodes?: MeshNodeRow[];
  topologyTitle?: string;
  mermaid?: string;
  boardName?: string;
  columns?: WorkerColumn[];
}

const DEFAULT_TITLE = 'RAVEN Ops';
const DEFAULT_SUBTITLE = 'Lattice Mesh - Live Mission Control - Mac mini';
const DEFAULT_ACCENT = '#7c5cff';
const DEFAULT_SUMMARY =
  'All mesh nodes connected and serving. The viewer-desktop generator slate is registered and run_generator is painting composite workspaces live. One known core-side routing quirk on list_generators is isolated and non-blocking.';
const DEFAULT_HIGHLIGHTS = [
  '- **viewer_desktop** node connected with **7 surfaces** live; the 11-generator slate is registered at startup.',
  '- **run_generator** emits whole multi-panel workspaces in **one call** across both shells.',
  '- **list_generators** deliver is the lone open thread — core-side, non-blocking, run-by-slug unaffected.',
];
const DEFAULT_KPIS: OpsKpi[] = [
  { label: 'Mesh Nodes', value: '5', delta: 'all connected', good: true },
  { label: 'Surfaces', value: '7', delta: 'viewer_desktop', good: true },
  { label: 'Generators', value: '11', delta: '+1 raven_ops', good: true },
  { label: 'Workers Running', value: '2', delta: '3 queued', good: true },
  { label: 'Open Threads', value: '1', delta: 'list_generators', good: false },
  { label: 'Uptime', value: 'green', delta: 'no Sev-1s', good: true },
];
const DEFAULT_TABLE_TITLE = 'Mesh Node Health';
const DEFAULT_NODES: MeshNodeRow[] = [
  { node: 'core', role: 'router', status: 'green', surfaces: 'introspect/invoke', latencyMs: '4' },
  { node: 'viewer_desktop', role: 'shell', status: 'green', surfaces: '7', latencyMs: '12' },
  { node: 'viewer_spatial', role: 'shell', status: 'amber', surfaces: 'panels', latencyMs: '38' },
  { node: 'viewer_session', role: 'state', status: 'green', surfaces: 'get/set/handoff', latencyMs: '6' },
  { node: 'raven', role: 'agent', status: 'green', surfaces: 'orchestrator', latencyMs: '8' },
];
const DEFAULT_TOPOLOGY_TITLE = 'Mesh Topology';
const DEFAULT_MERMAID =
  'graph LR\n  R[RAVEN] --> C{Core}\n  C --> VD[viewer_desktop]\n  C --> VS[viewer_spatial]\n  C --> SE[viewer_session]\n  VD -->|run_generator| W[Workspaces]\n  SE -->|handoff| VS';
const DEFAULT_BOARD_NAME = 'RAVEN Workers';
const DEFAULT_COLUMNS: WorkerColumn[] = [
  {
    id: 'queued',
    title: 'Queued',
    cards: [
      { id: 'w1', title: 'Trace list_generators', detail: 'Core-side deliver routing', tags: ['mesh', 'debug'] },
      { id: 'w2', title: 'Splice viewer_session', detail: 'Complete unification', tags: ['sprint'] },
      { id: 'w3', title: 'Hide .viewer-tmp', detail: 'File-tree cleanup', tags: ['polish'] },
    ],
  },
  {
    id: 'running',
    title: 'Running',
    cards: [
      { id: 'w4', title: 'Author raven_ops', detail: 'This generator', tags: ['authoring', 'P1'] },
      { id: 'w5', title: 'SSH into mac-211', detail: 'Awaiting Tailscale check', tags: ['infra'] },
    ],
  },
  {
    id: 'done',
    title: 'Done',
    cards: [
      { id: 'w6', title: 'Generator-registry fix', detail: 'Pushed 3c45e4a', tags: ['shipped'] },
      { id: 'w7', title: 'Composite cockpit live', detail: '5 windows painted', tags: ['shipped'] },
    ],
  },
];

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

/** CSV with fixed row/column order. */
function toCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((r) => r.map(escapeCsvField).join(','));
  return lines.join('\n');
}

/** Markdown summary block (header / subtitle / blockquote / highlights). */
function summaryMd(title: string, subtitle: string, summary: string, highlights: string[]): string {
  const blocks = [`# ${title}`, `_${subtitle}_`, `> ${summary}`, '## Highlights\n\n' + highlights.join('\n')];
  return blocks.join('\n\n');
}

/** A self-contained KPI-tile grid as an HTML string. */
function kpiHtml(title: string, accent: string, tiles: OpsKpi[]): string {
  const head =
    '<div style="font-family:-apple-system,system-ui,sans-serif;' +
    'padding:20px;background:#0f1117;color:#e6e6e6">' +
    `<h2 style="margin:0 0 16px;color:${accent}">${title} - Key Metrics</h2>` +
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

/** Canonical kanban content: fixed key order, compact JSON. */
function boardContent(name: string, columns: WorkerColumn[]): string {
  const obj = {
    name,
    columns: columns.map((c) => ({
      id: c.id,
      title: c.title,
      cards: c.cards.map((card) => ({
        id: card.id,
        title: card.title,
        description: card.detail,
        tags: card.tags,
      })),
    })),
  };
  return JSON.stringify(obj);
}

/** Pure build: params -> five Views of mixed type (RAVEN's whole ops cockpit). */
export function build(params: RavenOpsParams = {}): View[] {
  const title = params.title ?? DEFAULT_TITLE;
  const subtitle = params.subtitle ?? DEFAULT_SUBTITLE;
  const accent = params.accent ?? DEFAULT_ACCENT;
  const summary = params.summary ?? DEFAULT_SUMMARY;
  const highlights = params.highlights ?? DEFAULT_HIGHLIGHTS;
  const kpis = params.kpis ?? DEFAULT_KPIS;
  const tableTitle = params.tableTitle ?? DEFAULT_TABLE_TITLE;
  const nodes = params.nodes ?? DEFAULT_NODES;
  const topologyTitle = params.topologyTitle ?? DEFAULT_TOPOLOGY_TITLE;
  const mermaid = params.mermaid ?? DEFAULT_MERMAID;
  const boardName = params.boardName ?? DEFAULT_BOARD_NAME;
  const columns = params.columns ?? DEFAULT_COLUMNS;

  const summaryDoc = summaryMd(title, subtitle, summary, highlights);
  const kpiDoc = kpiHtml(title, accent, kpis);
  const tableHeader = ['Node', 'Role', 'Status', 'Surfaces', 'p95 ms'];
  const tableRows = nodes.map((n) => [n.node, n.role, n.status, n.surfaces, n.latencyMs]);
  const csv = toCsv(tableHeader, tableRows);
  const board = boardContent(boardName, columns);

  return [
    {
      id: 'raven-ops-summary',
      type: 'markdown',
      title,
      source: { kind: 'inline', value: summaryDoc },
      layout: LAYOUT[0],
      meta: GRID[0],
    },
    {
      id: 'raven-ops-kpis',
      type: 'html',
      title: 'Key Metrics',
      source: { kind: 'inline', value: kpiDoc },
      layout: LAYOUT[1],
      meta: GRID[1],
    },
    {
      id: 'raven-ops-table',
      type: 'table',
      title: tableTitle,
      source: { kind: 'inline', value: csv, mediaType: 'text/csv' },
      layout: LAYOUT[2],
      meta: GRID[2],
    },
    {
      id: 'raven-ops-topology',
      type: 'mermaid',
      title: topologyTitle,
      source: { kind: 'inline', value: mermaid },
      layout: LAYOUT[3],
      meta: GRID[3],
    },
    {
      id: 'raven-ops-board',
      type: 'kanban',
      title: boardName,
      source: { kind: 'inline', value: board },
      layout: LAYOUT[4],
      meta: GRID[4],
    },
  ];
}

export const ravenOpsGenerator: GeneratorEntry<RavenOpsParams> = {
  slug: 'raven_ops',
  describe:
    "Emit RAVEN's live ops cockpit (markdown+html+table+mermaid+kanban): system summary, KPI tiles, mesh-node health, topology, and a worker board.",
  generate: build,
};

/** Register the raven_ops generator with the shared registry. */
export function registerRavenOpsGenerator(): void {
  registerGenerator(ravenOpsGenerator as GeneratorEntry);
}
