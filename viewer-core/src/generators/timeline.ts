/**
 * The timeline generator — the proof case for time-series narrative Views.
 *
 * A pure `build(params) -> View[]` that emits ONE `html` View: a self-contained,
 * dark-theme vertical timeline (a project history / product roadmap) with a
 * single inline `<style>` block and NO external scripts or resources, so it
 * renders identically inside the desktop shell's window and the spatial shell's
 * sandboxed WKWebView panel.
 *
 * The HTML document is assembled from a fixed array of lines joined by '\n' so it
 * is byte-identical to the Python mirror (python/generators/timeline.py) for the
 * same input — that string identity is what the cross-language SHA pin in the
 * tests asserts. Calling with no params yields a full Viewer Ecosystem Roadmap.
 *
 * Keep this in lockstep with python/generators/timeline.py. Dependency-free
 * beyond what knowledge-graph.ts uses.
 */
import type { View } from '../schema/view';
import type { GeneratorEntry } from './types';
import { registerGenerator } from './runGenerator';

export interface TimelineEvent {
  date: string;
  title: string;
  body: string;
}
export interface TimelineParams {
  id?: string;
  title?: string;
  subtitle?: string;
  events?: TimelineEvent[];
}

const DEFAULT_TITLE = 'Viewer Ecosystem Roadmap';
const DEFAULT_SUBTITLE = 'From the View contract to a ten-archetype demo gallery';
const DEFAULT_EVENTS: TimelineEvent[] = [
  {
    date: '2025 Q1',
    title: 'View contract v1',
    body: 'Locked the platform-agnostic View schema — id, type, source, layout — shared by the desktop and spatial shells.',
  },
  {
    date: '2025 Q2',
    title: 'Desktop shell ships',
    body: 'viewer-desktop (Electron) renders every View type in tabbed windows using the shared React renderers.',
  },
  {
    date: '2025 Q3',
    title: 'Spatial shell preview',
    body: 'viewer-spatial brings the same Views to Vision Pro as floating WKWebView panels — zero renderer forks.',
  },
  {
    date: '2025 Q4',
    title: 'Declarative generator path',
    body: 'Pure params -> View[] generators land, with a Python mirror that emits byte-identical JSON server-side.',
  },
  {
    date: '2026 Q1',
    title: 'Mesh-backed sessions',
    body: 'Lattice viewer sessions enable one-call workspace handoff between the desktop and the headset.',
  },
  {
    date: '2026 Q2',
    title: 'Cross-language parity suite',
    body: 'Fixtures pin markdown, kanban, table, and graph output to the byte — both shells stay in lockstep.',
  },
  {
    date: '2026 Q3',
    title: 'Public demo gallery',
    body: 'Ten archetype demos ship as the canonical showcase for authoring Views in either shell.',
  },
];

/** CSS for the timeline. A fixed array of lines so TS and Python join identically. */
const STYLE_LINES: string[] = [
  '*{box-sizing:border-box;}',
  'body{margin:0;padding:32px;background:#0d1117;color:#e6edf3;',
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}',
  '.timeline-title{font-size:24px;font-weight:600;margin:0 0 4px;}',
  '.timeline-sub{color:#8b949e;font-size:14px;margin:0 0 28px;}',
  'ol.timeline{list-style:none;margin:0;padding:0;position:relative;}',
  'ol.timeline::before{content:"";position:absolute;left:11px;top:6px;bottom:6px;width:2px;background:#30363d;}',
  'li.event{position:relative;padding:0 0 28px 40px;}',
  'li.event:last-child{padding-bottom:0;}',
  'li.event::before{content:"";position:absolute;left:4px;top:4px;width:16px;height:16px;border-radius:50%;',
  'background:#4a9eff;border:3px solid #0d1117;box-shadow:0 0 0 1px #30363d;}',
  '.event-date{color:#4a9eff;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;}',
  '.event-title{font-size:16px;font-weight:600;margin:2px 0 4px;}',
  '.event-body{color:#8b949e;font-size:14px;line-height:1.5;margin:0;}',
];

/** Minimal HTML-text escaping. Order matters: `&` first. Must match the Python mirror. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Assemble the full HTML document. Built from a fixed line array joined by '\n'
 * so the serialized string equals the Python mirror's byte-for-byte.
 */
function buildHtml(title: string, subtitle: string, events: TimelineEvent[]): string {
  const eventLines = events.map(
    (e) =>
      `<li class="event"><div class="event-date">${escapeHtml(e.date)}</div>` +
      `<div class="event-title">${escapeHtml(e.title)}</div>` +
      `<p class="event-body">${escapeHtml(e.body)}</p></li>`
  );
  const lines: string[] = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>',
    ...STYLE_LINES,
    '</style>',
    '</head>',
    '<body>',
    `<h1 class="timeline-title">${escapeHtml(title)}</h1>`,
    `<p class="timeline-sub">${escapeHtml(subtitle)}</p>`,
    '<ol class="timeline">',
    ...eventLines,
    '</ol>',
    '</body>',
    '</html>',
  ];
  return lines.join('\n');
}

/** Pure build: params -> exactly one html timeline View. */
export function build(params: TimelineParams = {}): View[] {
  const title = params.title ?? DEFAULT_TITLE;
  const subtitle = params.subtitle ?? DEFAULT_SUBTITLE;
  const events = params.events ?? DEFAULT_EVENTS;
  const html = buildHtml(title, subtitle, events);
  const view: View = {
    id: params.id ?? 'timeline',
    type: 'html',
    title,
    source: { kind: 'inline', value: html },
    layout: { w: 0.9, h: 1, hint: 'tall' },
  };
  return [view];
}

export const timelineGenerator: GeneratorEntry<TimelineParams> = {
  slug: 'timeline',
  describe: 'Emit an html vertical-timeline View from chronological events (defaults to a demo roadmap).',
  generate: build,
};

/** Register the timeline generator with the shared registry. */
export function registerTimelineGenerator(): void {
  registerGenerator(timelineGenerator as GeneratorEntry);
}
