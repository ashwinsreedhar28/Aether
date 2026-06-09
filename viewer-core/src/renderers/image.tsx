/**
 * Image renderer — displays a resolved image with zoom/rotate controls.
 *
 * Pure: `data.content` is the image source (a data URL the host produced from
 * file bytes, or an http(s) URL). The renderer never reads the file itself.
 */
import { useState } from 'react';
import type { ViewRendererProps } from './registry';

const ctrlBtn =
  'px-1.5 py-0.5 text-xs text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors';

export function ImageRenderer({ view, data }: ViewRendererProps) {
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--holo-border)] bg-[rgba(15,15,25,0.5)]">
        <span className="text-xs text-[var(--holo-muted)] truncate max-w-[60%]">
          {view.title ?? 'Image'}
        </span>
        <div className="flex items-center gap-1">
          <button className={ctrlBtn} title="Zoom out" onClick={() => setZoom((z) => Math.max(z - 25, 25))}>
            −
          </button>
          <span className="text-xs text-[var(--holo-muted)] w-12 text-center">{zoom}%</span>
          <button className={ctrlBtn} title="Zoom in" onClick={() => setZoom((z) => Math.min(z + 25, 400))}>
            +
          </button>
          <div className="w-px h-4 bg-[var(--holo-border)] mx-1" />
          <button className={ctrlBtn} title="Rotate" onClick={() => setRotation((r) => (r + 90) % 360)}>
            ⟳
          </button>
          <button
            className={ctrlBtn}
            title="Reset"
            onClick={() => {
              setZoom(100);
              setRotation(0);
            }}
          >
            ⤢
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-[rgba(0,0,0,0.3)]">
        <img
          src={data.content}
          alt={view.title ?? 'Image'}
          className="transition-transform duration-200"
          style={{
            transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
            maxWidth: zoom <= 100 ? '100%' : 'none',
            maxHeight: zoom <= 100 ? '100%' : 'none',
            objectFit: 'contain',
          }}
        />
      </div>
    </div>
  );
}
