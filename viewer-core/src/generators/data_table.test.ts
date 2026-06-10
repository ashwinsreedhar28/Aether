/**
 * data_table generator coverage + cross-language parity (TS side).
 *
 * The EXPECTED_CSV constant below is byte-identical to the one pinned in the
 * Python suite (python/generators/test_data_table.py). Both sides assert their
 * generator's `source.value` equals this exact string, so the two generators
 * cannot drift: a shape change on either side turns that side's run red.
 */
import { describe, it, expect } from 'vitest';
import { build, dataTableGenerator } from './data_table';
import { runGenerator } from './runGenerator';
import { assertView } from '../schema/validate';

// Byte-exact mirror of the Python EXPECTED_CSV. The parity contract lives here.
const EXPECTED_CSV =
  'Date,Focus,Exercises,Sets,Volume (lbs)\n' +
  '5 Oct 2025,Back & Biceps,7,24,17190\n' +
  '7 Oct 2025,Full Body,5,16,16156\n' +
  '8 Oct 2025,Chest & Triceps,6,22,9350\n' +
  '12 Oct 2025,Back & Biceps,5,18,14020\n' +
  '22 Oct 2025,Back & Biceps,5,18,16380\n' +
  '23 Oct 2025,Chest & Triceps,4,16,13670\n' +
  '26 Oct 2025,Back & Biceps,3,11,9750\n' +
  '28 Oct 2025,Legs,5,15,19000\n' +
  '30 Oct 2025,Chest & Triceps,5,19,11900\n' +
  '2 Nov 2025,Back & Biceps,4,16,14680';

describe('data_table generator', () => {
  it('default emits exactly one valid table View', () => {
    const views = runGenerator(build, {});
    expect(views).toHaveLength(1);
    const [view] = views;
    assertView(view);
    expect(view.type).toBe('table');
    expect(view.id).toBe('table');
    expect(view.title).toBe('Training Log');
    expect(view.source.kind).toBe('inline');
    expect(view.source.mediaType).toBe('text/csv');
  });

  it('default content is byte-exact CSV (cross-language parity pin)', () => {
    const [view] = build();
    expect(view.source.value).toBe(EXPECTED_CSV);
  });

  it('default CSV is populated: header + 10 rows, 5 columns each', () => {
    const rows = build()[0].source.value.split('\n');
    expect(rows).toHaveLength(11);
    expect(rows[0].split(',')).toEqual(['Date', 'Focus', 'Exercises', 'Sets', 'Volume (lbs)']);
    for (const line of rows.slice(1)) {
      expect(line.split(',')).toHaveLength(5);
    }
  });

  it('uses a supplied csv verbatim', () => {
    const csv = 'a,b\n1,2';
    const [view] = build({ csv, title: 'Custom' });
    expect(view.source.value).toBe(csv);
    expect(view.title).toBe('Custom');
  });

  it('quotes fields containing a comma (RFC 4180)', () => {
    const [view] = build({ csv: 'name,note\nAcme,"a, b"' });
    expect(view.source.value).toContain('"a, b"');
  });

  it('exposes a registry entry with the data_table slug', () => {
    expect(dataTableGenerator.slug).toBe('data_table');
    expect(typeof dataTableGenerator.generate).toBe('function');
  });

  it('allows id and title overrides', () => {
    const [view] = build({ id: 'log1', title: 'Q4' });
    expect(view.id).toBe('log1');
    expect(view.title).toBe('Q4');
  });
});
