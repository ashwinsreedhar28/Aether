/**
 * The renderer registry — the contract every shared content renderer implements
 * and the lookup both shells use to render a View.
 *
 * A ViewRenderer is a PURE presentation component: given a View and its already-
 * resolved data, it returns a React node. It does NOT read files, fetch URLs,
 * touch Electron, or assume a window/panel. Resolution is the host's job. This
 * is what lets the exact same renderer mount inside a desktop window OR inside a
 * spatial HTML panel.
 */

import type { ReactNode } from 'react';
import type { View, ViewType, ResolvedViewData } from '../schema/view';

/** Props every shared renderer receives. */
export interface ViewRendererProps {
  /** The view being rendered (id, title, type, layout, meta). */
  view: View;
  /** Host-resolved content. Renderers parse `data.content` per their type. */
  data: ResolvedViewData;
  /**
   * Optional host callbacks. Renderers stay pure but may signal intent upward.
   * Hosts wire these to platform behavior (desktop: tab title; spatial: caption).
   */
  onTitleChange?: (title: string) => void;
  /** Editable content changed (e.g. markdown/text editing). Host decides persistence. */
  onContentChange?: (next: string) => void;
  /** True when this view is the focused/active one in its shell. */
  isActive?: boolean;
}

/** A renderer component for a given ViewType. */
export type ViewRenderer = (props: ViewRendererProps) => ReactNode;

/** Registry entry describing a renderer's capabilities. */
export interface RendererEntry {
  type: ViewType;
  render: ViewRenderer;
  /** Does this renderer support in-place editing? (markdown/text/json). */
  editable?: boolean;
  /** File extensions this view type is the natural handler for. */
  fileTypes?: string[];
}

const registry = new Map<ViewType, RendererEntry>();

/** Register (or replace) the renderer for a view type. */
export function registerRenderer(entry: RendererEntry): void {
  registry.set(entry.type, entry);
}

/** Register many at once. */
export function registerRenderers(entries: RendererEntry[]): void {
  for (const e of entries) registry.set(e.type, e);
}

/** Look up the renderer for a view type, or undefined if none registered. */
export function getRenderer(type: ViewType): RendererEntry | undefined {
  return registry.get(type);
}

/** Every registered renderer entry. */
export function getRenderers(): RendererEntry[] {
  return Array.from(registry.values());
}

/** Resolve the natural view type for a file path by extension. */
export function viewTypeForFile(path: string): ViewType | undefined {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  for (const entry of registry.values()) {
    if (entry.fileTypes?.includes(ext)) return entry.type;
  }
  return undefined;
}

/** Clear the registry (test helper). */
export function _resetRegistry(): void {
  registry.clear();
}
