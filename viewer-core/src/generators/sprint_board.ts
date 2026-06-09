/**
 * The sprint-board generator — a kanban demo for the declarative path.
 *
 * A pure `build(params) -> View[]` that emits ONE `kanban` View whose inline
 * source is the EXACT JSON the shared kanban renderer parses (see
 * renderers/kanban.tsx: it reads `data.content` as a board document
 * `{name?, description?, columns:[{id,title,color?,cards?:[{id,title,description?,tags?,priority?,dueDate?}]}]}`).
 *
 * The content is serialized with a fixed key order and compact separators so it
 * is byte-identical to the Python mirror (python/generators/sprint_board.py) for
 * the same input — that string identity is what the cross-language fixture test
 * pins down. Calling with no params yields a real, populated sprint board.
 */
import type { View } from '../schema/view';
import type { GeneratorEntry } from './types';
import { registerGenerator } from './runGenerator';

export type CardPriority = 'P1' | 'P2' | 'P3';

export interface BoardCard {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  priority?: CardPriority;
  dueDate?: string;
}
export interface BoardColumn {
  id: string;
  title: string;
  color?: string;
  cards?: BoardCard[];
}
export interface SprintBoardParams {
  id?: string;
  title?: string;
  name?: string;
  description?: string;
  columns?: BoardColumn[];
}

const DEFAULT_NAME = 'Lattice — Auth & API · Sprint 14';
const DEFAULT_DESCRIPTION = 'Two-week sprint · 6 engineers · goal: ship SSO + cursor pagination';
const DEFAULT_COLUMNS: BoardColumn[] = [
  {
    id: 'backlog',
    title: 'Backlog',
    color: '#64748b',
    cards: [
      {
        id: 'bl-1',
        title: 'OAuth refresh-token rotation',
        description: 'Rotate the refresh token on every use and revoke the prior one to kill replay.',
        tags: ['backend', 'auth'],
        priority: 'P1',
        dueDate: '2026-06-19',
      },
      {
        id: 'bl-2',
        title: 'Rate-limit the public /search API',
        description: 'Sliding-window limiter at the gateway: 100 req/min per API key.',
        tags: ['backend', 'api'],
        priority: 'P2',
      },
      {
        id: 'bl-3',
        title: 'Dark-mode contrast audit',
        description: 'WCAG AA pass across the settings and billing screens.',
        tags: ['frontend', 'a11y'],
        priority: 'P3',
      },
      {
        id: 'bl-4',
        title: 'Migrate sessions table to Postgres 16',
        description: 'Drop the legacy MySQL store; backfill ~2M rows behind a dual-write.',
        tags: ['infra'],
        priority: 'P2',
      },
    ],
  },
  {
    id: 'in-progress',
    title: 'In Progress',
    color: '#3b82f6',
    cards: [
      {
        id: 'ip-1',
        title: 'SSO login via SAML',
        description: 'Okta + Azure AD; finishing assertion signature validation.',
        tags: ['backend', 'auth'],
        priority: 'P1',
        dueDate: '2026-06-12',
      },
      {
        id: 'ip-2',
        title: 'Redesign the onboarding wizard',
        description: 'Three-step flow that persists progress between steps.',
        tags: ['frontend'],
        priority: 'P2',
      },
      {
        id: 'ip-3',
        title: 'Fix N+1 query on dashboard load',
        description: 'Batch the per-widget metric fetch into a single round-trip.',
        tags: ['backend', 'perf'],
        priority: 'P1',
      },
    ],
  },
  {
    id: 'review',
    title: 'Review',
    color: '#f59e0b',
    cards: [
      {
        id: 'rv-1',
        title: 'Cursor pagination for /events',
        description: 'Replace offset paging with opaque base64 cursors.',
        tags: ['api', 'backend'],
        priority: 'P2',
      },
      {
        id: 'rv-2',
        title: 'Card drag-and-drop polish',
        description: 'Keyboard reorder plus a reduced-motion fallback.',
        tags: ['frontend'],
        priority: 'P3',
      },
      {
        id: 'rv-3',
        title: 'Audit-log CSV export',
        description: 'Stream the export so large tenants never OOM the worker.',
        tags: ['backend'],
        priority: 'P2',
        dueDate: '2026-06-10',
      },
    ],
  },
  {
    id: 'done',
    title: 'Done',
    color: '#22c55e',
    cards: [
      {
        id: 'dn-1',
        title: 'Password breach check (HIBP)',
        description: 'k-anonymity range query on signup and password reset.',
        tags: ['auth', 'security'],
        priority: 'P1',
      },
      {
        id: 'dn-2',
        title: 'Upgrade React 18 → 19',
        description: 'Adopt concurrent features; removed the last findDOMNode call.',
        tags: ['frontend'],
        priority: 'P2',
      },
      {
        id: 'dn-3',
        title: 'Stabilize flaky checkout e2e',
        description: 'Wait on network-idle instead of a fixed sleep.',
        tags: ['qa'],
        priority: 'P3',
      },
      {
        id: 'dn-4',
        title: 'Add /healthz readiness probe',
        description: 'Gateway now reports DB + cache health for the k8s probe.',
        tags: ['infra'],
        priority: 'P3',
      },
    ],
  },
];

/**
 * Canonicalize content into the renderer's board shape with a fixed key order
 * and only the optional keys that are present. Must stay in lockstep with the
 * Python mirror's `_build_content` so `JSON.stringify` here equals
 * `json.dumps(..., separators=(",", ":"))` there.
 */
function buildContent(
  name: string,
  description: string | undefined,
  columns: BoardColumn[],
): Record<string, unknown> {
  const board: Record<string, unknown> = { name };
  if (description !== undefined) board.description = description;
  board.columns = columns.map((col) => {
    const c: Record<string, unknown> = { id: col.id, title: col.title };
    if (col.color !== undefined) c.color = col.color;
    if (col.cards !== undefined) {
      c.cards = col.cards.map((card) => {
        const o: Record<string, unknown> = { id: card.id, title: card.title };
        if (card.description !== undefined) o.description = card.description;
        if (card.tags !== undefined) o.tags = card.tags.map((t) => t);
        if (card.priority !== undefined) o.priority = card.priority;
        if (card.dueDate !== undefined) o.dueDate = card.dueDate;
        return o;
      });
    }
    return c;
  });
  return board;
}

/** Pure build: params -> exactly one kanban View. */
export function build(params: SprintBoardParams = {}): View[] {
  const name = params.name ?? DEFAULT_NAME;
  const description = params.description ?? DEFAULT_DESCRIPTION;
  const columns = params.columns ?? DEFAULT_COLUMNS;
  const content = buildContent(name, description, columns);
  const view: View = {
    id: params.id ?? 'sprint-board',
    type: 'kanban',
    title: params.title ?? 'Sprint Board',
    source: { kind: 'inline', value: JSON.stringify(content) },
    layout: { w: 1.4, h: 1.0, hint: 'wide' },
  };
  return [view];
}

export const sprintBoardGenerator: GeneratorEntry<SprintBoardParams> = {
  slug: 'sprint_board',
  describe: 'Emit a kanban View of a software sprint board (defaults to a populated demo board).',
  generate: build,
};

/** Register the sprint-board generator with the shared registry. */
export function registerSprintBoardGenerator(): void {
  registerGenerator(sprintBoardGenerator as GeneratorEntry);
}
