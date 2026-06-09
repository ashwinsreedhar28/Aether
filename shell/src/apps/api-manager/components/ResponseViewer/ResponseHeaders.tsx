/**
 * ResponseHeaders Component
 * Response headers display
 */

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface ResponseHeadersProps {
  headers: Record<string, string>;
}

export function ResponseHeaders({ headers }: ResponseHeadersProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = async (key: string, value: string) => {
    await navigator.clipboard.writeText(`${key}: ${value}`);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const headerEntries = Object.entries(headers);

  if (headerEntries.length === 0) {
    return (
      <div className="text-center text-[var(--holo-muted)] text-sm py-8">
        No response headers
      </div>
    );
  }

  return (
    <div className="p-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-[var(--holo-muted)]">
            <th className="pb-2 pr-4">Header</th>
            <th className="pb-2">Value</th>
            <th className="pb-2 w-10" />
          </tr>
        </thead>
        <tbody>
          {headerEntries.map(([key, value]) => (
            <tr key={key} className="border-t border-[var(--holo-border)] group">
              <td className="py-2 pr-4 font-medium text-[var(--holo-accent)]">
                {key}
              </td>
              <td className="py-2 font-mono text-xs break-all">{value}</td>
              <td className="py-2">
                <button
                  onClick={() => handleCopy(key, value)}
                  className="p-1 rounded hover:bg-[var(--holo-accent)]/20 text-[var(--holo-muted)] hover:text-[var(--holo-accent)] opacity-0 group-hover:opacity-100 transition-all"
                >
                  {copiedKey === key ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
