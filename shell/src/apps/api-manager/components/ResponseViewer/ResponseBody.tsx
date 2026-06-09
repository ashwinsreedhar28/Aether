/**
 * ResponseBody Component
 * Formatted response body display
 */

import { useState } from 'react';
import { Copy, Check, WrapText } from 'lucide-react';
import type { ApiResponse } from '../../types';

interface ResponseBodyProps {
  body: string;
  bodyType: ApiResponse['bodyType'];
}

export function ResponseBody({ body, bodyType }: ResponseBodyProps) {
  const [copied, setCopied] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Try to format JSON
  let formattedBody = body;
  if (bodyType === 'json') {
    try {
      formattedBody = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      // Keep original if parsing fails
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b border-[var(--holo-border)]">
        <button
          onClick={() => setWordWrap(!wordWrap)}
          className={`p-1.5 rounded transition-colors ${
            wordWrap
              ? 'bg-[var(--holo-accent)]/20 text-[var(--holo-accent)]'
              : 'text-[var(--holo-muted)] hover:text-[var(--holo-text)]'
          }`}
          title="Toggle word wrap"
        >
          <WrapText size={14} />
        </button>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/30 transition-colors"
        >
          {copied ? (
            <>
              <Check size={12} />
              Copied
            </>
          ) : (
            <>
              <Copy size={12} />
              Copy
            </>
          )}
        </button>
      </div>

      {/* Body content */}
      <div className="flex-1 overflow-auto p-3">
        {body ? (
          <pre
            className={`text-sm font-mono ${
              wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
            }`}
          >
            {bodyType === 'json' ? (
              <JsonHighlight json={formattedBody} />
            ) : (
              formattedBody
            )}
          </pre>
        ) : (
          <div className="text-center text-[var(--holo-muted)] text-sm py-8">
            No response body
          </div>
        )}
      </div>
    </div>
  );
}

function JsonHighlight({ json }: { json: string }) {
  // Simple JSON syntax highlighting
  const highlighted = json
    .replace(
      /("(?:[^"\\]|\\.)*")\s*:/g,
      '<span class="text-purple-400">$1</span>:'
    )
    .replace(
      /:\s*("(?:[^"\\]|\\.)*")/g,
      ': <span class="text-green-400">$1</span>'
    )
    .replace(
      /:\s*(\d+\.?\d*)/g,
      ': <span class="text-blue-400">$1</span>'
    )
    .replace(
      /:\s*(true|false)/g,
      ': <span class="text-yellow-400">$1</span>'
    )
    .replace(
      /:\s*(null)/g,
      ': <span class="text-red-400">$1</span>'
    );

  return <span dangerouslySetInnerHTML={{ __html: highlighted }} />;
}
