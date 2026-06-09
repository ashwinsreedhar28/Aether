/**
 * @viewer/core — shared View contract + platform-agnostic content renderers.
 *
 * The single source of truth for the viewer ecosystem. Both viewer-desktop
 * (macOS shell) and viewer-spatial (visionOS shell) consume this package so the
 * content layer and the agent-control layer are defined exactly once.
 */

// Schema (the keystone)
export type {
  View,
  ViewType,
  ViewSource,
  ViewLayout,
  ResolvedViewData,
  Session,
} from './schema/view';
export { VIEW_TYPES } from './schema/view';
export { validateView, assertView } from './schema/validate';
export type { ValidationResult } from './schema/validate';

// Renderer registry + built-in shared renderers
export {
  registerRenderer,
  registerRenderers,
  getRenderer,
  getRenderers,
  viewTypeForFile,
  _resetRegistry,
  registerBuiltinRenderers,
  MarkdownRenderer,
  TextRenderer,
  JsonRenderer,
  MermaidRenderer,
  MermaidBlock,
  KanbanRenderer,
  KnowledgeGraphRenderer,
  ImageRenderer,
  HtmlRenderer,
  LatexRenderer,
  parseLatex,
  TableRenderer,
} from './renderers';
export type {
  ViewRenderer,
  ViewRendererProps,
  RendererEntry,
} from './renderers/registry';

// Generators — the declarative agent-authoring path (a generator EMITS Views)
export {
  runGenerator,
  registerGenerator,
  getGenerator,
  listGenerators,
  _resetGenerators,
  registerAllGenerators,
  ALL_GENERATORS,
  buildKnowledgeGraph,
  knowledgeGraphGenerator,
  registerKnowledgeGraphGenerator,
  buildSprintBoard,
  sprintBoardGenerator,
  buildDataTable,
  dataTableGenerator,
  buildFlowDiagram,
  flowDiagramGenerator,
  buildStatusReport,
  statusReportGenerator,
  buildMathSheet,
  mathSheetGenerator,
  buildMetricTiles,
  metricTilesGenerator,
  buildTimeline,
  timelineGenerator,
  buildImageGallery,
  imageGalleryGenerator,
  buildJsonInspector,
  jsonInspectorGenerator,
  buildWorkspace,
  workspaceGenerator,
  buildRavenOps,
  ravenOpsGenerator,
} from './generators';
export type {
  Generator,
  GeneratorEntry,
  KgNode,
  KgEdge,
  KgParams,
} from './generators';
