/**
 * Built-in renderer registration.
 *
 * `registerBuiltinRenderers()` registers every shared content renderer with the
 * registry. Both shells call it once at startup so `getRenderer(view.type)`
 * resolves to a pure `(view, data) => ReactNode` renderer. File-type hints here
 * mirror the desktop app's natural handlers so `viewTypeForFile` agrees.
 */
import { registerRenderers } from './registry';
import { MarkdownRenderer } from './markdown';
import { TextRenderer } from './text';
import { JsonRenderer } from './json';
import { MermaidRenderer } from './mermaid';
import { KanbanRenderer } from './kanban';
import { KnowledgeGraphRenderer } from './knowledge-graph';
import { ImageRenderer } from './image';
import { HtmlRenderer } from './html';
import { LatexRenderer } from './latex';
import { TableRenderer } from './table';

let registered = false;

export function registerBuiltinRenderers(): void {
  if (registered) return;
  registerRenderers([
    { type: 'markdown', render: MarkdownRenderer, editable: true, fileTypes: ['md', 'markdown'] },
    { type: 'text', render: TextRenderer, editable: true, fileTypes: ['txt', 'log'] },
    { type: 'json', render: JsonRenderer, editable: true, fileTypes: ['json'] },
    { type: 'mermaid', render: MermaidRenderer, fileTypes: ['mmd', 'mermaid'] },
    { type: 'kanban', render: KanbanRenderer, fileTypes: ['kanban'] },
    { type: 'knowledge-graph', render: KnowledgeGraphRenderer, fileTypes: ['mindmap'] },
    { type: 'image', render: ImageRenderer, fileTypes: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'] },
    { type: 'html', render: HtmlRenderer, fileTypes: ['html', 'htm'] },
    { type: 'latex', render: LatexRenderer, fileTypes: ['tex', 'latex'] },
    { type: 'table', render: TableRenderer, fileTypes: ['csv', 'tsv'] },
  ]);
  registered = true;
}
