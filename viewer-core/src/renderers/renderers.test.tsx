import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TextRenderer } from './text';
import { JsonRenderer } from './json';
import { HtmlRenderer } from './html';
import { TableRenderer } from './table';
import {
  registerBuiltinRenderers,
  getRenderer,
  viewTypeForFile,
  _resetRegistry,
} from './index';
import type { View, ResolvedViewData } from '../schema/view';

function view(type: View['type']): View {
  return { id: 'v1', type, title: 'T', source: { kind: 'inline', value: 'x' } };
}
const data = (content: string, extra: Partial<ResolvedViewData> = {}): ResolvedViewData => ({
  content,
  ...extra,
});

describe('TextRenderer', () => {
  it('renders content in a view <pre>', () => {
    const html = renderToStaticMarkup(
      <TextRenderer view={view('text')} data={data('hello world')} />
    );
    expect(html).toContain('hello world');
    expect(html).toContain('<pre');
  });

  it('omits the Edit button when not editable', () => {
    const html = renderToStaticMarkup(<TextRenderer view={view('text')} data={data('a')} />);
    expect(html).not.toContain('>Edit<');
  });

  it('shows the Edit button when onContentChange is provided', () => {
    const html = renderToStaticMarkup(
      <TextRenderer view={view('text')} data={data('a')} onContentChange={() => {}} />
    );
    expect(html).toContain('>Edit<');
  });
});

describe('JsonRenderer', () => {
  it('pretty-prints valid JSON', () => {
    const html = renderToStaticMarkup(
      <JsonRenderer view={view('json')} data={data('{"a":1}')} />
    );
    expect(html).toContain('&quot;a&quot;: 1');
  });

  it('flags invalid JSON but still shows the raw text', () => {
    const html = renderToStaticMarkup(
      <JsonRenderer view={view('json')} data={data('{not json')} />
    );
    expect(html).toContain('Invalid JSON');
    expect(html).toContain('{not json');
  });
});

describe('HtmlRenderer', () => {
  it('renders inline html via srcdoc', () => {
    const html = renderToStaticMarkup(
      <HtmlRenderer view={view('html')} data={data('<h1>Hi</h1>')} />
    );
    expect(html.toLowerCase()).toContain('srcdoc');
    expect(html).toContain('sandbox');
  });

  it('uses src when the content is a URL', () => {
    const html = renderToStaticMarkup(
      <HtmlRenderer view={view('html')} data={data('https://example.com', { isUrl: true })} />
    );
    expect(html).toContain('src="https://example.com"');
  });
});

describe('TableRenderer', () => {
  it('renders CSV with a header row and body cells', () => {
    const html = renderToStaticMarkup(
      <TableRenderer view={view('table')} data={data('name,age\nAda,36\nGrace,40')} />
    );
    expect(html).toContain('<th');
    expect(html).toContain('name');
    expect(html).toContain('Ada');
    expect(html).toContain('Grace');
  });

  it('handles quoted fields containing commas', () => {
    const html = renderToStaticMarkup(
      <TableRenderer view={view('table')} data={data('a,b\n"x,y",z')} />
    );
    expect(html).toContain('x,y');
  });
});

describe('registerBuiltinRenderers', () => {
  it('registers every view type with a resolvable renderer', () => {
    _resetRegistry();
    registerBuiltinRenderers();
    for (const t of ['markdown', 'text', 'json', 'mermaid', 'kanban', 'knowledge-graph', 'image', 'html', 'latex', 'table'] as const) {
      expect(getRenderer(t), `renderer for ${t}`).toBeTruthy();
    }
    expect(getRenderer('markdown')?.editable).toBe(true);
    expect(viewTypeForFile('notes.md')).toBe('markdown');
    expect(viewTypeForFile('data.csv')).toBe('table');
  });
});
