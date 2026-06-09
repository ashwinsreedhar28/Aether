/**
 * Runtime validation for the View contract. Dependency-free (no ajv) — a View
 * is small enough to validate by hand, and keeping it dep-free means the mesh
 * layer and both shells can validate without pulling a schema library.
 */

import type { View, ViewSource, ViewLayout } from './view';
import { VIEW_TYPES } from './view';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const SOURCE_KINDS = new Set(['inline', 'path', 'url']);
const LAYOUT_HINTS = new Set(['default', 'wide', 'tall', 'compact', 'focus']);

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function validateSource(src: unknown, errors: string[]): void {
  if (!isPlainObject(src)) {
    errors.push('source must be an object');
    return;
  }
  const s = src as Partial<ViewSource>;
  if (typeof s.kind !== 'string' || !SOURCE_KINDS.has(s.kind)) {
    errors.push(`source.kind must be one of inline|path|url (got ${String(s.kind)})`);
  }
  if (typeof s.value !== 'string') {
    errors.push('source.value must be a string');
  } else if (s.value.length === 0) {
    errors.push('source.value must be non-empty');
  }
  if (s.mediaType !== undefined && typeof s.mediaType !== 'string') {
    errors.push('source.mediaType must be a string when present');
  }
}

function validateLayout(layout: unknown, errors: string[]): void {
  if (!isPlainObject(layout)) {
    errors.push('layout must be an object when present');
    return;
  }
  const l = layout as Partial<ViewLayout>;
  for (const k of ['w', 'h'] as const) {
    if (l[k] !== undefined && (typeof l[k] !== 'number' || Number.isNaN(l[k]))) {
      errors.push(`layout.${k} must be a number when present`);
    }
  }
  if (l.hint !== undefined && !LAYOUT_HINTS.has(l.hint)) {
    errors.push(`layout.hint must be one of ${Array.from(LAYOUT_HINTS).join('|')}`);
  }
}

/** Validate an unknown value as a View. Returns all errors (not just the first). */
export function validateView(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(value)) {
    return { ok: false, errors: ['view must be an object'] };
  }
  const v = value as Partial<View>;

  if (typeof v.id !== 'string' || v.id.length === 0) {
    errors.push('id must be a non-empty string');
  }
  if (typeof v.type !== 'string' || !VIEW_TYPES.includes(v.type as never)) {
    errors.push(`type must be one of ${VIEW_TYPES.join('|')} (got ${String(v.type)})`);
  }
  if (v.title !== undefined && typeof v.title !== 'string') {
    errors.push('title must be a string when present');
  }
  if (v.source === undefined) {
    errors.push('source is required');
  } else {
    validateSource(v.source, errors);
  }
  if (v.layout !== undefined) {
    validateLayout(v.layout, errors);
  }
  if (v.meta !== undefined && !isPlainObject(v.meta)) {
    errors.push('meta must be an object when present');
  }

  return { ok: errors.length === 0, errors };
}

/** Throwing variant — returns the value narrowed to View, or throws with all errors. */
export function assertView(value: unknown): View {
  const { ok, errors } = validateView(value);
  if (!ok) {
    throw new Error(`Invalid View: ${errors.join('; ')}`);
  }
  return value as View;
}
