/**
 * Markdown renderer — GitHub-flavored markdown with math, syntax highlighting,
 * and inline Mermaid diagrams. Editable via a plain textarea.
 *
 * Pure: renders `data.content`; edits bubble up through `onContentChange`. The
 * host owns persistence. (The desktop app previously layered Monaco + in-preview
 * search on top of this; those are host/shell concerns and are intentionally not
 * part of the shared renderer.)
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypePrismPlus from 'rehype-prism-plus';
import { MermaidBlock } from './mermaid';
import type { ViewRendererProps } from './registry';

const toolbarBtn = (active: boolean) =>
  `px-2 py-0.5 text-xs rounded transition-colors ${
    active
      ? 'bg-[var(--holo-accent)]/30 text-[var(--holo-accent)]'
      : 'text-[var(--holo-muted)] hover:text-[var(--holo-text)]'
  }`;

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

function MarkdownPreview({ source }: { source: string }) {
  const counterRef = useRef(0);
  const components = useMemo<Components>(
    () => ({
      code({ className, children, ...props }) {
        const match = /language-(\w+)/.exec(className || '');
        const language = match ? match[1] : '';
        if (language === 'mermaid') {
          const codeContent = extractText(children).replace(/\n$/, '');
          return <MermaidBlock code={codeContent} idPrefix={`md-${counterRef.current++}`} />;
        }
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
      pre({ children, ...props }) {
        const child = children as { type?: unknown };
        if (child?.type === MermaidBlock) return <>{children}</>;
        return <pre {...props}>{children}</pre>;
      },
    }),
    []
  );

  return (
    <div className="h-full overflow-auto">
      <div className="p-4 prose prose-invert prose-sm max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, rehypePrismPlus]}
          components={components}
        >
          {source}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export function MarkdownRenderer({ data, onContentChange }: ViewRendererProps) {
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
          Preview
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
          <MarkdownPreview source={data.content} />
        )}
      </div>
    </div>
  );
}
