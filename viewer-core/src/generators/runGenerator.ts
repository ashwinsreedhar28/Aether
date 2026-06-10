/**
 * runGenerator + a tiny generator registry.
 *
 * `runGenerator` is the safety boundary of the declarative path: it calls the
 * generator and `assertView`s EVERY emitted View, so a generator that emits an
 * invalid View throws clearly instead of leaking a malformed payload into a
 * shell. This is the guarantee that lets agents author Views by code with the
 * same confidence the imperative tool path gives them.
 *
 * The registry mirrors the renderer registry (register/get/list) so both halves
 * of the ecosystem are addressed the same way.
 */
import type { View } from '../schema/view';
import { assertView } from '../schema/validate';
import type { Generator, GeneratorEntry } from './types';

function isEntry<P>(g: Generator<P> | GeneratorEntry<P>): g is GeneratorEntry<P> {
  return typeof g === 'object' && g !== null && typeof (g as GeneratorEntry<P>).generate === 'function';
}

/**
 * Run a generator (or a registry entry) and validate every emitted View.
 * Throws if the generator returns a non-array or any invalid View.
 */
export function runGenerator<P>(gen: Generator<P> | GeneratorEntry<P>, params: P): View[] {
  const fn = isEntry(gen) ? gen.generate : gen;
  const out = fn(params);
  if (!Array.isArray(out)) {
    throw new Error('generator must return an array of Views');
  }
  return out.map((v, i) => {
    try {
      return assertView(v);
    } catch (e) {
      throw new Error(`generator emitted invalid View at index ${i}: ${(e as Error).message}`);
    }
  });
}

const registry = new Map<string, GeneratorEntry>();

/** Register (or replace) a generator by slug. */
export function registerGenerator(entry: GeneratorEntry): void {
  registry.set(entry.slug, entry);
}

/** Look up a generator entry by slug, or undefined if none registered. */
export function getGenerator(slug: string): GeneratorEntry | undefined {
  return registry.get(slug);
}

/** Every registered generator entry. */
export function listGenerators(): GeneratorEntry[] {
  return Array.from(registry.values());
}

/** Clear the registry (test helper). */
export function _resetGenerators(): void {
  registry.clear();
}
