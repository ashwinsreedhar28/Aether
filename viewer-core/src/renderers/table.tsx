/**
 * Table renderer — renders CSV / tabular text as an HTML table.
 *
 * Pure: parses `data.content` as delimited text (comma by default, tab if the
 * mediaType says so) and renders the first row as a header. There is no desktop
 * equivalent today — this is a new shared renderer the spatial shell can use for
 * `text/csv` content.
 */
import { useMemo } from 'react';
import type { ViewRendererProps } from './registry';

/** Minimal RFC-4180-ish CSV parser: handles quoted fields and escaped quotes. */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

export function TableRenderer({ data }: ViewRendererProps) {
  const rows = useMemo(() => {
    const delimiter = data.mediaType?.includes('tab') ? '\t' : ',';
    return parseDelimited(data.content, delimiter);
  }, [data.content, data.mediaType]);

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--holo-muted)]">
        Empty table
      </div>
    );
  }

  const [header, ...body] = rows;

  return (
    <div className="h-full overflow-auto p-2">
      <table className="w-full text-sm text-left border-collapse text-[var(--holo-text)]">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th
                key={i}
                className="px-3 py-1.5 border-b border-[var(--holo-border)] font-semibold sticky top-0 bg-[rgba(15,15,25,0.9)]"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className="hover:bg-white/5">
              {header.map((_, ci) => (
                <td key={ci} className="px-3 py-1 border-b border-[var(--holo-border)]/40">
                  {r[ci] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
