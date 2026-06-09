/**
 * JSON renderer — pretty-prints JSON for viewing and offers a raw text editor.
 *
 * Pure: parses `data.content` only to format the view; edits bubble up via
 * `onContentChange`. Invalid JSON falls back to showing the raw text so the
 * user can still see and fix it.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ViewRendererProps } from './registry';

const toolbarBtn = (active: boolean) =>
  `px-2 py-0.5 text-xs rounded transition-colors ${
    active
      ? 'bg-[var(--holo-accent)]/30 text-[var(--holo-accent)]'
      : 'text-[var(--holo-muted)] hover:text-[var(--holo-text)]'
  }`;

function formatJson(raw: string): { text: string; valid: boolean } {
  try {
    return { text: JSON.stringify(JSON.parse(raw), null, 2), valid: true };
  } catch {
    return { text: raw, valid: false };
  }
}

export function JsonRenderer({ data, onContentChange }: ViewRendererProps) {
  const editable = typeof onContentChange === 'function';
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(data.content);

  useEffect(() => {
    setDraft(data.content);
  }, [data.content]);

  const formatted = useMemo(() => formatJson(data.content), [data.content]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--holo-border)] bg-[rgba(15,15,25,0.5)]">
        <button onClick={() => setIsEditing(false)} className={toolbarBtn(!isEditing)}>
          View
        </button>
        {editable && (
          <button onClick={() => setIsEditing(true)} className={toolbarBtn(isEditing)}>
            Edit
          </button>
        )}
        {!formatted.valid && (
          <span className="text-xs text-amber-400 ml-auto">Invalid JSON</span>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        {isEditing && editable ? (
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              onContentChange?.(e.target.value);
            }}
            spellCheck={false}
            className="w-full h-full resize-none bg-transparent text-[var(--holo-text)] font-mono text-sm p-4 outline-none"
          />
        ) : (
          <pre className="h-full overflow-auto p-4 text-sm font-mono text-[var(--holo-text)] whitespace-pre-wrap">
            {formatted.text}
          </pre>
        )}
      </div>
    </div>
  );
}
