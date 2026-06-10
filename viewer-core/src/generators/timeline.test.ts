/**
 * timeline generator (TS side) + cross-language parity pin.
 *
 * The default HTML document is deterministic, so its byte-exact SHA-256 is a
 * stable contract. The Python suite (python/generators/test_timeline.py) asserts
 * the SAME hash against `timeline_build`. One constant, two readers: if either
 * side's HTML drifts by a single byte, that side turns red.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { build, timelineGenerator, registerTimelineGenerator } from './timeline';
import { runGenerator, getGenerator } from './runGenerator';
import { assertView } from '../schema/validate';

// Byte-exact SHA-256 of the default timeline's source.value. Must equal the Python pin.
const DEFAULT_SHA = '43f5123a5ee93b1a36dc0f9c288ff44cd05ea9c3a548374bd7ea67ca38dd530f';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

describe('timeline generator (TS)', () => {
  it('emits one valid html View by default', () => {
    const [view] = runGenerator(build, {});
    assertView(view);
    expect(view.type).toBe('html');
    expect(view.id).toBe('timeline');
    expect(view.title).toBe('Viewer Ecosystem Roadmap');
    expect(view.source.kind).toBe('inline');
    expect(view.layout).toEqual({ w: 0.9, h: 1, hint: 'tall' });
  });

  it('default document is byte-identical to the Python mirror (SHA pin)', () => {
    const [view] = build();
    expect(sha256(view.source.value)).toBe(DEFAULT_SHA);
  });

  it('default document is a real, self-contained dark-theme timeline', () => {
    const html = build()[0].source.value;
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<style>'); // inline CSS only
    expect(html).not.toContain('<script'); // no external/inline scripts
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    expect(html).toContain('background:#0d1117'); // dark theme
    expect(html).toContain('ol.timeline::before'); // the vertical line
    expect(html).toContain('li.event::before'); // the dots
    expect(html).toContain('View contract v1'); // a real event
    expect(html).toContain('Public demo gallery'); // the last event
    // 7 events => 7 <li> nodes.
    expect(html.split('<li class="event">').length - 1).toBe(7);
  });

  it('honors custom params and escapes HTML-significant characters', () => {
    const [view] = build({
      id: 'hist',
      title: 'A & B <release>',
      subtitle: 'sub "q"',
      events: [{ date: '2026', title: 'Ship <v1>', body: 'a & b' }],
    });
    expect(view.id).toBe('hist');
    expect(view.title).toBe('A & B <release>');
    expect(view.source.value).toContain('<h1 class="timeline-title">A &amp; B &lt;release&gt;</h1>');
    expect(view.source.value).toContain('<p class="timeline-sub">sub &quot;q&quot;</p>');
    expect(view.source.value).toContain('<div class="event-title">Ship &lt;v1&gt;</div>');
    expect(view.source.value).toContain('<p class="event-body">a &amp; b</p>');
    expect(view.source.value.split('<li class="event">').length - 1).toBe(1);
  });

  it('registers under its slug', () => {
    registerTimelineGenerator();
    expect(getGenerator('timeline')?.slug).toBe('timeline');
    expect(timelineGenerator.slug).toBe('timeline');
  });
});
