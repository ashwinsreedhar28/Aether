/**
 * The metric_tiles generator — the proof case for self-contained HTML panels.
 *
 * A pure `build(params) -> View[]` that emits ONE `html` View whose inline source
 * is a fully self-contained KPI dashboard: big-number stat tiles in a responsive
 * grid, dark theme, all CSS inlined, NO external resources or scripts (so it
 * renders inside the sandboxed iframe/WKWebView the html renderer uses — see
 * renderers/html.tsx, which drops `data.content` straight into `srcDoc`).
 *
 * The HTML is assembled from an ordered list of lines joined by '\n' so it is
 * byte-identical to the Python mirror (python/generators/metric_tiles.py) for the
 * same input — that string identity is what the cross-language SHA pin asserts.
 * Calling with no params yields a believable product dashboard.
 */
import type { View } from '../schema/view';
import type { GeneratorEntry } from './types';
import { registerGenerator } from './runGenerator';

export interface MetricTile {
  label: string;
  value: string;
  delta?: string;
}
export interface MetricTilesParams {
  id?: string;
  title?: string;
  tiles?: MetricTile[];
}

const DEFAULT_TITLE = 'Product Metrics';
const DEFAULT_TILES: MetricTile[] = [
  { label: 'Monthly Revenue', value: '$1.24M', delta: '↑ 12.4%' },
  { label: 'Active Users', value: '84,312', delta: '↑ 6.1%' },
  { label: 'Uptime (30d)', value: '99.97%', delta: '↑ 0.02%' },
  { label: 'Net Revenue Retention', value: '118%', delta: '↑ 3 pts' },
  { label: 'Gross Margin', value: '74%', delta: '↓ 1.2%' },
  { label: 'Cash Runway', value: '16 mo', delta: '↓ 2 mo' },
  { label: 'NPS', value: '62', delta: '↑ 4' },
  { label: 'Deploys / week', value: '37', delta: '↑ 9' },
];

// Inlined dark-theme CSS, line-for-line identical to the Python mirror.
const CSS_LINES: string[] = [
  ':root{--bg:#0b0e14;--panel:#141a24;--panel2:#1b2330;--text:#e6edf3;--muted:#8b98a9;--up:#3fb950;--down:#f85149;--flat:#8b98a9;--accent:#4a9eff;--border:#222c3a}',
  '*{box-sizing:border-box;margin:0;padding:0}',
  'html,body{height:100%}',
  'body{background:radial-gradient(1200px 800px at 20% -10%,#16202e 0%,var(--bg) 60%);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;padding:32px}',
  '.dash{max-width:1100px;margin:0 auto}',
  '.dash__head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:24px;border-bottom:1px solid var(--border);padding-bottom:16px}',
  '.dash__title{font-size:22px;font-weight:650;letter-spacing:.2px}',
  '.dash__sub{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}',
  '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}',
  '.tile{position:relative;background:linear-gradient(180deg,var(--panel2) 0%,var(--panel) 100%);border:1px solid var(--border);border-radius:14px;padding:20px 22px;box-shadow:0 1px 0 rgba(255,255,255,.03) inset,0 8px 24px rgba(0,0,0,.35);overflow:hidden}',
  '.tile::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--accent);opacity:.6}',
  '.tile__label{color:var(--muted);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px}',
  '.tile__value{font-size:34px;font-weight:700;line-height:1.05;letter-spacing:-.5px;font-variant-numeric:tabular-nums}',
  '.tile__delta{display:inline-flex;align-items:center;margin-top:12px;font-size:13px;font-weight:600;padding:3px 9px;border-radius:999px;font-variant-numeric:tabular-nums}',
  '.tile__delta--up{color:var(--up);background:rgba(63,185,80,.12)}',
  '.tile__delta--down{color:var(--down);background:rgba(248,81,73,.12)}',
  '.tile__delta--flat{color:var(--flat);background:rgba(139,152,169,.12)}',
];

/** HTML-escape a value identically to the Python mirror (& first, fixed order). */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Classify a delta by its leading glyph: up (↑/+), down (↓/-/−), else flat. */
function trend(delta: string): 'up' | 'down' | 'flat' {
  const c = delta.trim().charAt(0);
  if (c === '↑' || c === '+') return 'up';
  if (c === '↓' || c === '-' || c === '\u2212') return 'down';
  return 'flat';
}

/**
 * Assemble the self-contained dashboard document from ordered lines joined by
 * '\n'. Must stay in lockstep with the Python mirror's `_build_html` so the
 * resulting string is byte-identical.
 */
function buildHtml(title: string, tiles: MetricTile[]): string {
  const lines: string[] = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${esc(title)}</title>`,
    '<style>',
    ...CSS_LINES,
    '</style>',
    '</head>',
    '<body>',
    '<main class="dash">',
    '<header class="dash__head">',
    `<h1 class="dash__title">${esc(title)}</h1>`,
    `<p class="dash__sub">${tiles.length} live metrics</p>`,
    '</header>',
    '<section class="grid">',
  ];
  for (const t of tiles) {
    lines.push('<article class="tile">');
    lines.push(`<div class="tile__label">${esc(t.label)}</div>`);
    lines.push(`<div class="tile__value">${esc(t.value)}</div>`);
    if (t.delta !== undefined) {
      lines.push(`<div class="tile__delta tile__delta--${trend(t.delta)}">${esc(t.delta)}</div>`);
    }
    lines.push('</article>');
  }
  lines.push('</section>');
  lines.push('</main>');
  lines.push('</body>');
  lines.push('</html>');
  return lines.join('\n');
}

/** Pure build: params -> exactly one html View. */
export function build(params: MetricTilesParams = {}): View[] {
  const title = params.title ?? DEFAULT_TITLE;
  const tiles = params.tiles ?? DEFAULT_TILES;
  const content = buildHtml(title, tiles);
  const view: View = {
    id: params.id ?? 'metrics',
    type: 'html',
    title: params.title ?? DEFAULT_TITLE,
    source: { kind: 'inline', value: content },
    layout: { w: 1.2, h: 0.8, hint: 'wide' },
  };
  return [view];
}

export const metricTilesGenerator: GeneratorEntry<MetricTilesParams> = {
  slug: 'metric_tiles',
  describe: 'Emit a self-contained HTML KPI-tile dashboard View (defaults to a product dashboard).',
  generate: build,
};

/** Register the metric_tiles generator with the shared registry. */
export function registerMetricTilesGenerator(): void {
  registerGenerator(metricTilesGenerator as GeneratorEntry);
}
