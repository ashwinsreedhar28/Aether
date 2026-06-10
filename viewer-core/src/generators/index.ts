/**
 * Generators surface — the declarative agent-authoring path.
 *
 * A generator EMITS Views (the counterpart to a tool, which PLACES Views).
 * `runGenerator` validates every emitted View; the registry mirrors the renderer
 * registry. The knowledge-graph generator is the cross-platform proof case; the
 * remaining generators are the demo slate exercising every View type across both
 * the desktop and spatial shells.
 *
 * `registerAllGenerators()` is the single populate-the-registry seam consumers
 * (the desktop mesh node, the spatial generator server) call once at startup —
 * one call instead of N. Idempotent: re-registering the same slug overwrites.
 */
import { registerGenerator } from './runGenerator';
import { knowledgeGraphGenerator } from './knowledge-graph';
import { sprintBoardGenerator } from './sprint_board';
import { dataTableGenerator } from './data_table';
import { flowDiagramGenerator } from './flow_diagram';
import { statusReportGenerator } from './status_report';
import { mathSheetGenerator } from './math_sheet';
import { metricTilesGenerator } from './metric_tiles';
import { timelineGenerator } from './timeline';
import { imageGalleryGenerator } from './image_gallery';
import { jsonInspectorGenerator } from './json_inspector';
import { workspaceGenerator } from './workspace';
import { ravenOpsGenerator } from './raven_ops';
import type { GeneratorEntry } from './types';

export type { Generator, GeneratorEntry } from './types';
export {
  runGenerator,
  registerGenerator,
  getGenerator,
  listGenerators,
  _resetGenerators,
} from './runGenerator';

// Knowledge-graph — the cross-platform parity proof case.
export {
  build as buildKnowledgeGraph,
  knowledgeGraphGenerator,
  registerKnowledgeGraphGenerator,
} from './knowledge-graph';
export type { KgNode, KgEdge, KgParams } from './knowledge-graph';

// Demo slate — one generator per View family.
export { build as buildSprintBoard, sprintBoardGenerator } from './sprint_board';
export { build as buildDataTable, dataTableGenerator } from './data_table';
export { build as buildFlowDiagram, flowDiagramGenerator } from './flow_diagram';
export { build as buildStatusReport, statusReportGenerator } from './status_report';
export { build as buildMathSheet, mathSheetGenerator } from './math_sheet';
export { build as buildMetricTiles, metricTilesGenerator } from './metric_tiles';
export { build as buildTimeline, timelineGenerator } from './timeline';
export { build as buildImageGallery, imageGalleryGenerator } from './image_gallery';
export { build as buildJsonInspector, jsonInspectorGenerator } from './json_inspector';
export { build as buildWorkspace, workspaceGenerator } from './workspace';
export { build as buildRavenOps, ravenOpsGenerator } from './raven_ops';

/** Every generator in the slate, in slate order (knowledge-graph first). */
export const ALL_GENERATORS: GeneratorEntry[] = [
  knowledgeGraphGenerator as GeneratorEntry,
  sprintBoardGenerator as GeneratorEntry,
  dataTableGenerator as GeneratorEntry,
  flowDiagramGenerator as GeneratorEntry,
  statusReportGenerator as GeneratorEntry,
  mathSheetGenerator as GeneratorEntry,
  metricTilesGenerator as GeneratorEntry,
  timelineGenerator as GeneratorEntry,
  imageGalleryGenerator as GeneratorEntry,
  jsonInspectorGenerator as GeneratorEntry,
  workspaceGenerator as GeneratorEntry,
  ravenOpsGenerator as GeneratorEntry,
];

/**
 * Register every slate generator with the shared registry. Consumers call this
 * once at startup so `getGenerator(slug)` resolves any slate slug. Idempotent.
 */
export function registerAllGenerators(): void {
  for (const entry of ALL_GENERATORS) registerGenerator(entry);
}
