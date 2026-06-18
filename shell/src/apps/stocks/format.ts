// Shared formatting + tone helpers for the Stocks app (grid + detail page).
// Two consumers (StocksApp, StockDetail) in one app dir — kept here rather
// than duplicated. Tone is inline colours (not Tailwind classes) so the
// same value drives both text and the SVG stroke.

export const UP = '#34d399'; // emerald-400
export const DOWN = '#f87171'; // red-400

export function tone(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n === 0) return 'var(--holo-muted)';
  return n > 0 ? UP : DOWN;
}

export function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtChange(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}`;
}

export function fmtPct(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

// Compact share volume: 1.2B / 40.3M / 812K. 0 / missing → em dash.
export function fmtVolume(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

// Compact market cap: $3.1T / $812.4B / $45.2M.
export function fmtMarketCap(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString('en-US')}`;
}

export function fmtRatio(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '—';
  return n.toFixed(1);
}

// Sector display order (semantic, not alphabetical — §11.1). Mirrors
// SECTOR_ORDER in nodes/finance/src/tickers.ts; the node owns the canonical
// list, this is the renderer's reading order. Sectors not listed sort
// after these (alpha); "Other / Unclassified" always pins to the end.
export const SECTOR_ORDER: string[] = [
  'Semiconductors',
  'Software',
  'Internet & Media',
  'Technology Hardware',
  'Cloud Infrastructure',
  'Electronic Components',
  'Electronic Manufacturing',
  'Defense',
  'Aerospace',
  'Automotive',
  'Industrials',
  'Mining',
  'Materials',
  'Consumer & Retail',
  'Index ETFs',
];

export const UNCLASSIFIED = 'Other / Unclassified';

/** Sort sector group names by SECTOR_ORDER, then alpha, with UNCLASSIFIED last. */
export function orderSectors(names: string[]): string[] {
  return [...names].sort((a, b) => {
    if (a === UNCLASSIFIED) return 1;
    if (b === UNCLASSIFIED) return -1;
    const ia = SECTOR_ORDER.indexOf(a);
    const ib = SECTOR_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}
