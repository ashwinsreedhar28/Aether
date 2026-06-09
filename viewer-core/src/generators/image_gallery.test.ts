/**
 * image_gallery generator (TS side) + cross-language parity pin.
 *
 * The default HTML document is deterministic, so its byte-exact SHA-256 is a
 * stable contract. The Python suite (python/generators/test_image_gallery.py)
 * asserts the SAME hash against `image_gallery_build`. One constant, two readers:
 * if either side's HTML drifts by a single byte, that side turns red.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { build, imageGalleryGenerator, registerImageGalleryGenerator } from './image_gallery';
import { runGenerator, getGenerator } from './runGenerator';
import { assertView } from '../schema/validate';

// Byte-exact SHA-256 of the default gallery's source.value. Must equal the Python pin.
const DEFAULT_SHA = '755fd9bceaf9a3e1b263308ec40a58068664958ac52a206d0e3974f62ec7e91b';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

describe('image_gallery generator (TS)', () => {
  it('emits one valid html View by default', () => {
    const [view] = runGenerator(build, {});
    assertView(view);
    expect(view.type).toBe('html');
    expect(view.id).toBe('gallery');
    expect(view.title).toBe('Spatial Gallery');
    expect(view.source.kind).toBe('inline');
    expect(view.layout).toEqual({ w: 1.4, h: 1, hint: 'wide' });
  });

  it('default document is byte-identical to the Python mirror (SHA pin)', () => {
    const [view] = build();
    expect(sha256(view.source.value)).toBe(DEFAULT_SHA);
  });

  it('default document is a real, self-contained dark-theme grid', () => {
    const html = build()[0].source.value;
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('background:#0b0d12'); // dark theme
    expect(html).toContain('grid-template-columns:repeat(auto-fill,minmax(260px,1fr))'); // responsive grid
    expect(html).toContain('<linearGradient'); // programmatic SVG gradients
    expect(html).toContain('Nebula'); // a real tile label
    expect(html).toContain('Crystalline lattice'); // a real caption
    // Fully self-contained: no external asset loads (the only http URI is the
    // SVG XML namespace, which is an identifier, not a network fetch).
    expect(html).not.toContain('src="http');
    expect(html).not.toContain('href="http');
    expect(html).not.toContain('url(http');
    expect(html).not.toContain('https://');
  });

  it('renders exactly six inline-SVG tiles by default', () => {
    const html = build()[0].source.value;
    expect((html.match(/<figure class="card">/g) ?? []).length).toBe(6);
    expect((html.match(/<svg /g) ?? []).length).toBe(6);
  });

  it('honors custom images + title (img cards, escaped)', () => {
    const [view] = build({
      id: 'shots',
      title: 'Render <Farm>',
      images: [
        { src: 'data:image/png;base64,AAAA', caption: 'Frame "01"' },
        { src: 'data:image/png;base64,BBBB', caption: 'Frame 02 & 03' },
      ],
    });
    expect(view.id).toBe('shots');
    expect(view.title).toBe('Render <Farm>');
    const html = view.source.value;
    expect(html).toContain('<h1>Render &lt;Farm&gt;</h1>'); // title escaped
    expect(html).toContain('<img src="data:image/png;base64,AAAA"'); // image card
    expect(html).toContain('Frame &quot;01&quot;'); // caption escaped
    expect(html).toContain('Frame 02 &amp; 03'); // ampersand escaped
    expect(html).toContain('2 panels - self-contained, no external assets'); // count in subtitle
    expect(html).not.toContain('<svg '); // no default tiles when images given
  });

  it('honors a custom subtitle', () => {
    const html = build({ subtitle: 'Curated set' })[0].source.value;
    expect(html).toContain('<p class="sub">Curated set</p>');
  });

  it('registers under its slug', () => {
    registerImageGalleryGenerator();
    expect(getGenerator('image_gallery')?.slug).toBe('image_gallery');
    expect(imageGalleryGenerator.slug).toBe('image_gallery');
  });
});
