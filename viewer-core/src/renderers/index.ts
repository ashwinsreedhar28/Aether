/**
 * Renderer registry surface + the built-in shared content renderers.
 *
 * The contract + lookup live in `registry`. The concrete renderers (markdown,
 * text, json, mermaid, kanban, knowledge-graph, image, html, latex, table) are
 * registered via `registerBuiltinRenderers()`.
 */
export {
  registerRenderer,
  registerRenderers,
  getRenderer,
  getRenderers,
  viewTypeForFile,
  _resetRegistry,
} from './registry';
export type { ViewRenderer, ViewRendererProps, RendererEntry } from './registry';

export { registerBuiltinRenderers } from './builtin';

export { MarkdownRenderer } from './markdown';
export { TextRenderer } from './text';
export { JsonRenderer } from './json';
export { MermaidRenderer, MermaidBlock } from './mermaid';
export { KanbanRenderer } from './kanban';
export { KnowledgeGraphRenderer } from './knowledge-graph';
export { ImageRenderer } from './image';
export { HtmlRenderer } from './html';
export { LatexRenderer, parseLatex } from './latex';
export { TableRenderer } from './table';
