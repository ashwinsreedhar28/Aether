/**
 * HTML renderer — shows resolved HTML in a sandboxed iframe.
 *
 * Pure: if `data.isUrl` is set the iframe points at the URL; otherwise the
 * resolved markup is rendered via `srcDoc`. No file IO, no Electron.
 */
import type { ViewRendererProps } from './registry';

export function HtmlRenderer({ data }: ViewRendererProps) {
  return (
    <div className="h-full">
      <iframe
        {...(data.isUrl ? { src: data.content } : { srcDoc: data.content })}
        className="w-full h-full border-0 bg-white"
        title="HTML Preview"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
