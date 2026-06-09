/**
 * The data_table generator — a sortable tabular View from realistic data.
 *
 * A pure `build(params) -> View[]` that emits ONE `table` View whose inline
 * source is a CSV string the shared table renderer parses (see
 * renderers/table.tsx: it reads `data.content` as delimited text, first row =
 * header, comma by default / tab when mediaType says so).
 *
 * The CSV is assembled with a fixed column order and a deterministic RFC-4180-ish
 * escaper, so the serialized `source.value` string is byte-identical to the
 * Python mirror (python/generators/data_table.py) for the same input — that
 * string identity is what the cross-language parity test pins down. Calling with
 * no params yields a real demo: a 10-session strength-training log.
 */
import type { View } from '../schema/view';
import type { GeneratorEntry } from './types';
import { registerGenerator } from './runGenerator';

export interface DataTableParams {
  id?: string;
  title?: string;
  /** A ready-made CSV string. When present it is used verbatim as the content. */
  csv?: string;
}

/** Header + body for the default demo. A real 10-session training log. */
const DEFAULT_HEADER: string[] = ['Date', 'Focus', 'Exercises', 'Sets', 'Volume (lbs)'];
const DEFAULT_ROWS: string[][] = [
  ['5 Oct 2025', 'Back & Biceps', '7', '24', '17190'],
  ['7 Oct 2025', 'Full Body', '5', '16', '16156'],
  ['8 Oct 2025', 'Chest & Triceps', '6', '22', '9350'],
  ['12 Oct 2025', 'Back & Biceps', '5', '18', '14020'],
  ['22 Oct 2025', 'Back & Biceps', '5', '18', '16380'],
  ['23 Oct 2025', 'Chest & Triceps', '4', '16', '13670'],
  ['26 Oct 2025', 'Back & Biceps', '3', '11', '9750'],
  ['28 Oct 2025', 'Legs', '5', '15', '19000'],
  ['30 Oct 2025', 'Chest & Triceps', '5', '19', '11900'],
  ['2 Nov 2025', 'Back & Biceps', '4', '16', '14680'],
];

/** Quote a field only when it contains a comma, quote, or newline (RFC 4180). */
function escapeField(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}

/**
 * Build a CSV string with a fixed row/column order. Must stay in lockstep with
 * the Python mirror's `_to_csv` so the serialized content is byte-identical.
 */
function toCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((r) => r.map(escapeField).join(','));
  return lines.join('\n');
}

/** Pure build: params -> exactly one table View. */
export function build(params: DataTableParams = {}): View[] {
  const value = params.csv ?? toCsv(DEFAULT_HEADER, DEFAULT_ROWS);
  const view: View = {
    id: params.id ?? 'table',
    type: 'table',
    title: params.title ?? 'Training Log',
    source: { kind: 'inline', value, mediaType: 'text/csv' },
    layout: { w: 1.2, h: 0.9, hint: 'wide' },
  };
  return [view];
}

export const dataTableGenerator: GeneratorEntry<DataTableParams> = {
  slug: 'data_table',
  describe: 'Emit a sortable table View from CSV (defaults to a real training log).',
  generate: build,
};

/** Register the data_table generator with the shared registry. */
export function registerDataTableGenerator(): void {
  registerGenerator(dataTableGenerator as GeneratorEntry);
}
