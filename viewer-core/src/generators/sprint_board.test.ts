/**
 * Cross-language sprint-board generator parity (TS side).
 *
 * Runs the SHARED fixture (generators/sprint-board-fixture.json) through the TS
 * sprint-board `build`. The Python suite (python/generators/test_sprint_board.py)
 * runs the SAME file through `sprint_board_build`. Because both read one fixture
 * and assert against `expectedView` — including the byte-exact compact
 * `source.value` JSON string — the two generators cannot drift: a shape change
 * on either side turns that side's run red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build, type SprintBoardParams } from './sprint_board';
import { runGenerator } from './runGenerator';
import { assertView } from '../schema/validate';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '../../generators/sprint-board-fixture.json');

interface Fixture {
  input: SprintBoardParams;
  expectedView: unknown;
}
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('sprint-board generator parity (TS)', () => {
  it('emits exactly the fixture expectedView for the fixture input', () => {
    const views = build(fixture.input);
    expect(views).toHaveLength(1);
    expect(views[0]).toEqual(fixture.expectedView);
  });

  it('emits a valid View (source.value is parseable board JSON)', () => {
    const [view] = runGenerator(build, fixture.input);
    assertView(view);
    const content = JSON.parse(view.source.value);
    expect(content.columns).toHaveLength(2);
    expect(content.columns[0].cards).toHaveLength(1);
  });

  it('default build yields a real, populated sprint board', () => {
    const [view] = build();
    expect(view.type).toBe('kanban');
    const content = JSON.parse(view.source.value);
    expect(content.columns.map((c: { title: string }) => c.title)).toEqual([
      'Backlog',
      'In Progress',
      'Review',
      'Done',
    ]);
    const total = content.columns.reduce(
      (n: number, c: { cards?: unknown[] }) => n + (c.cards?.length ?? 0),
      0,
    );
    expect(total).toBeGreaterThanOrEqual(12);
  });
});
