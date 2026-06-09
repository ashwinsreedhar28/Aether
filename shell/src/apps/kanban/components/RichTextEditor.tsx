import { useEditor, EditorContent, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, CheckSquare, Heading1, Heading2 } from 'lucide-react';

interface RichTextEditorProps {
  content: string;
  onChange: (json: string, plainText: string) => void;
  placeholder?: string;
  fullHeight?: boolean;
}

export function RichTextEditor({ content, onChange, placeholder, fullHeight }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
      Placeholder.configure({
        placeholder: placeholder || 'Add description...',
        emptyEditorClass: 'is-editor-empty',
      }),
    ],
    content: parseContent(content),
    onUpdate: ({ editor }) => {
      const json = JSON.stringify(editor.getJSON());
      const plainText = editor.getText();
      onChange(json, plainText);
    },
    editorProps: {
      attributes: {
        class: `prose prose-sm prose-invert max-w-none focus:outline-none px-3 py-2 ${fullHeight ? 'h-full' : 'min-h-[100px]'}`,
      },
    },
  });

  if (!editor) return null;

  return (
    <div className={`border border-[var(--holo-border)] rounded bg-[rgba(0,0,0,0.35)] ${fullHeight ? 'h-full flex flex-col rich-text-editor-full' : 'rich-text-editor-compact'}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 border-b border-[var(--holo-border)] flex-wrap">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
          title="Bold"
        >
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          title="Italic"
        >
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive('underline')}
          title="Underline"
        >
          <UnderlineIcon size={14} />
        </ToolbarButton>

        <div className="w-px h-4 bg-[var(--holo-border)] mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          isActive={editor.isActive('heading', { level: 1 })}
          title="Heading 1"
        >
          <Heading1 size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive('heading', { level: 2 })}
          title="Heading 2"
        >
          <Heading2 size={14} />
        </ToolbarButton>

        <div className="w-px h-4 bg-[var(--holo-border)] mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
          title="Bullet List"
        >
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive('orderedList')}
          title="Numbered List"
        >
          <ListOrdered size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          isActive={editor.isActive('taskList')}
          title="Checklist"
        >
          <CheckSquare size={14} />
        </ToolbarButton>
      </div>

      {/* Editor Content */}
      <div className={fullHeight ? 'flex-1 min-h-0 overflow-auto' : ''}>
        <EditorContent editor={editor} className={fullHeight ? 'h-full' : ''} />
      </div>

      {/* Styles */}
      <style>{`
        .ProseMirror {
          padding: 0.5rem 0.75rem;
        }
        .rich-text-editor-full .ProseMirror {
          height: 100%;
        }
        .rich-text-editor-compact .ProseMirror {
          min-height: 100px;
        }
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: var(--holo-muted);
          pointer-events: none;
          height: 0;
        }
        .ProseMirror ul[data-type="taskList"] {
          list-style: none;
          padding: 0;
        }
        .ProseMirror ul[data-type="taskList"] li {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
        }
        .ProseMirror ul[data-type="taskList"] li > label {
          flex-shrink: 0;
          margin-top: 0.25rem;
        }
        .ProseMirror ul[data-type="taskList"] li > label input[type="checkbox"] {
          cursor: pointer;
          accent-color: var(--holo-accent);
        }
        .ProseMirror ul[data-type="taskList"] li[data-checked="true"] > div > p {
          text-decoration: line-through;
          opacity: 0.6;
        }
        .ProseMirror h1 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-top: 1rem;
          margin-bottom: 0.5rem;
        }
        .ProseMirror h2 {
          font-size: 1.1rem;
          font-weight: 600;
          margin-top: 0.75rem;
          margin-bottom: 0.25rem;
        }
        .ProseMirror ul, .ProseMirror ol {
          padding-left: 1.5rem;
        }
        .ProseMirror li {
          margin: 0.25rem 0;
        }
      `}</style>
    </div>
  );
}

function ToolbarButton({
  onClick,
  isActive,
  children,
  title
}: {
  onClick: () => void;
  isActive: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        isActive
          ? 'bg-[var(--holo-accent)]/20 text-[var(--holo-accent)]'
          : 'text-[var(--holo-muted)] hover:text-[var(--holo-text)] hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  );
}

function parseContent(content: string): string | JSONContent {
  if (!content) return '';
  try {
    const parsed = JSON.parse(content) as JSONContent;
    // Check if it's TipTap JSON format
    if (parsed.type === 'doc' && Array.isArray(parsed.content)) {
      return parsed;
    }
    // It's some other JSON, treat as plain text
    return content;
  } catch {
    // Plain text string
    return content;
  }
}

// Helper to extract checklist progress from TipTap JSON
// eslint-disable-next-line react-refresh/only-export-components -- helper co-located with the editor it supports
export function getChecklistProgress(content: string): { completed: number; total: number } | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as JSONContent;
    if (parsed.type !== 'doc') return null;

    let completed = 0;
    let total = 0;

    function traverse(node: JSONContent) {
      if (node.type === 'taskItem') {
        total++;
        if (node.attrs?.checked) {
          completed++;
        }
      }
      if (node.content) {
        node.content.forEach(traverse);
      }
    }

    traverse(parsed);
    return total > 0 ? { completed, total } : null;
  } catch {
    return null;
  }
}
