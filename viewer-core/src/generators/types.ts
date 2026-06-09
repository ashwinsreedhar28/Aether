/**
 * Generators — the declarative agent-authoring path.
 *
 * Two ways control a viewer: a *generator* EMITS Views (script → compiles →
 * scene, full model control), a *tool* PLACES Views (call → modifies → scene,
 * quick edits). Both are unified by the View contract: a generator is just a
 * pure function `params -> View[]`. Same emitted Views render via the 2D React
 * renderers on desktop and as html panels on spatial — one schema, one truth.
 *
 * Keep this tiny. A generator is a function, not a framework. There is no DSL,
 * no sandbox, no codegen here — only the type, a runner that validates output,
 * and a registry mirroring the renderer registry's shape.
 */
import type { View } from '../schema/view';

/** A generator: pure function from params to the Views it emits. */
export type Generator<P = Record<string, unknown>> = (params: P) => View[];

/** Registry entry describing a named generator (mirrors RendererEntry). */
export interface GeneratorEntry<P = any> {
  /** Stable slug used to address the generator (mesh-reachable name). */
  slug: string;
  /** One-line human description of what this generator emits. */
  describe: string;
  /** Optional JSON-schema-ish description of accepted params (advisory only). */
  paramsSchema?: object;
  /** The pure build function. */
  generate: Generator<P>;
}
