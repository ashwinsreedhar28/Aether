/**
 * Text renderer — a plain view/edit surface for arbitrary text content.
 *
 * Pure: it receives resolved text in `data.content` and bubbles edits up via
 * `onContentChange`. It never reads or writes files — persistence is the host's
 * job. Deliberately trivial (a <pre> view + a <textarea> edit), matching the
 * desktop text editor's role.
 */
import { useEffect, useState } from 'react';
import type { ViewRendererProps } from './registry';

const toolbarBtn = (active: boolean) =>
  `px-2 py-0.5 text-xs rounded transition-colors ${
    active
      ? 'bg-[var(--holo-accent)]/30 text-[var(--holo-accent)]'
      : 'text-[var(--holo-muted)] hover:text-[var(--holo-text)]'
  }`;

export function TextRenderer({ data, onContentChange }: ViewRendererProps) {
  const editable = typeof onContentChange === 'function';
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(data.content);

  useEffect(() => {
    setDraft(data.content);
  }, [data.content]);

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
            {data.content}
          </pre>
        )}
      </div>
    </div>
  );
}
