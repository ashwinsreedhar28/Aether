/**
 * Mermaid renderer — renders Mermaid diagram source to SVG.
 *
 * Pure with respect to the host: it receives diagram source in `data.content`
 * and renders it via the `mermaid` library (which uses the DOM, available in
 * both the Electron renderer and the spatial HTML panel). No file IO.
 */
import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import type { ViewRendererProps } from './registry';

let initialized = false;
function ensureInit() {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
    fontFamily: 'inherit',
  });
  initialized = true;
}

/** Renders a single Mermaid diagram inline. Reused by the markdown renderer. */
export function MermaidBlock({ code, idPrefix = 'mermaid' }: { code: string; idPrefix?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renderIdRef = useRef(0);

  useEffect(() => {
    ensureInit();
    const renderId = ++renderIdRef.current;
    setError(null);
    mermaid
      .render(`${idPrefix}-${renderId}-${Date.now()}`, code)
      .then(({ svg }) => {
        if (renderId === renderIdRef.current) setSvg(svg);
      })
      .catch((err: unknown) => {
        if (renderId === renderIdRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
          setSvg(null);
        }
      });
  }, [code, idPrefix]);

  if (error) {
    return (
      <div className="my-4 p-4 rounded-lg border border-red-500/50 bg-red-500/10">
        <div className="text-xs text-red-400 mb-2">Mermaid diagram error:</div>
        <pre className="text-xs text-red-300 whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }
  if (!svg) {
    return (
      <div className="my-4 p-4 rounded-lg border border-[var(--holo-border)] bg-[rgba(0,0,0,0.2)] flex items-center justify-center">
        <span className="text-xs text-[var(--holo-muted)]">Loading diagram...</span>
      </div>
    );
  }
  return (
    <div
      className="mermaid-svg-container flex items-center justify-center"
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{ color: 'var(--holo-text)' }}
    />
  );
}

export function MermaidRenderer({ view, data }: ViewRendererProps) {
  const [zoom, setZoom] = useState(100);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--holo-border)] bg-[rgba(15,15,25,0.5)]">
        <span className="text-xs text-[var(--holo-muted)] truncate max-w-[60%]">
          {view.title ?? 'Diagram'}
        </span>
        <div className="flex items-center gap-1">
          <button
            className="px-1.5 py-0.5 text-xs text-[var(--holo-muted)] hover:text-[var(--holo-text)]"
            onClick={() => setZoom((z) => Math.max(z - 25, 25))}
            title="Zoom out"
          >
            −
          </button>
          <span className="text-xs text-[var(--holo-muted)] w-12 text-center">{zoom}%</span>
          <button
            className="px-1.5 py-0.5 text-xs text-[var(--holo-muted)] hover:text-[var(--holo-text)]"
            onClick={() => setZoom((z) => Math.min(z + 25, 400))}
            title="Zoom in"
          >
            +
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-[rgba(0,0,0,0.3)] flex items-center justify-center">
        <div
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'center center' }}
        >
          <MermaidBlock code={data.content} idPrefix={`view-${view.id}`} />
        </div>
      </div>
    </div>
  );
}
