/**
 * The View contract — the single source of truth for the viewer ecosystem.
 *
 * A "View" is a platform-agnostic description of *what is being shown*: a typed
 * piece of content, where its data comes from, and a layout hint. It says
 * NOTHING about *how* it is shown. The desktop shell renders a View inside a
 * window; the spatial shell renders the same View as a floating HTML panel.
 *
 * This file is intentionally dependency-free (no React, no platform APIs) so it
 * can be imported by:
 *   - viewer-desktop (Electron renderer, TS)
 *   - viewer-spatial (the Node-side panel host + the Python bridge via its JSON shape)
 *   - the mesh node layer (open_view payloads ARE Views)
 *
 * Keep it small. Every field added here is a field three places must honor.
 */

/**
 * The content type of a View. This maps 1:1 to a registered renderer
 * (see renderers/registry.ts) and is the discriminator the host uses to decide
 * how to display the resolved data.
 *
 * These are the *pure-content* types shared across both shells. Platform-only
 * surfaces (terminal, browser, 3D scenes) are deliberately NOT
 * Views — they live in their own shell and never cross the boundary.
 */
export type ViewType =
  | 'markdown'
  | 'text'
  | 'json'
  | 'mermaid'
  | 'kanban'
  | 'knowledge-graph'
  | 'image'
  | 'html'
  | 'latex'
  | 'table'; // csv / tabular data

/** Every shared content type, as a runtime array (for validation + iteration). */
export const VIEW_TYPES: readonly ViewType[] = [
  'markdown',
  'text',
  'json',
  'mermaid',
  'kanban',
  'knowledge-graph',
  'image',
  'html',
  'latex',
  'table',
] as const;

/**
 * Where a View's data comes from. Resolution of a source into actual bytes is
 * the *host's* job (desktop reads a path via Electron fs; spatial fetches a URL
 * or is handed inline content). The renderer never resolves — it receives
 * already-resolved data.
 *
 *  - `inline`: the content is carried directly in `value` (a string).
 *  - `path`:   a filesystem path the host resolves (desktop: fs; spatial: bridge).
 *  - `url`:    an http(s) URL the host/renderer can fetch.
 */
export interface ViewSource {
  kind: 'inline' | 'path' | 'url';
  value: string;
  /** Optional MIME / extension hint to disambiguate (e.g. 'text/csv'). */
  mediaType?: string;
}

/**
 * A non-binding hint about how big/where the host should place this view.
 * The shell is free to ignore or adapt it (desktop uses px window size;
 * spatial uses meters for panel size). Values are unitless 0..1 fractions or
 * absolute, interpreted per-shell.
 */
export interface ViewLayout {
  /** Preferred width. Desktop: px (if >=1) or fraction of screen (if <1). Spatial: meters. */
  w?: number;
  /** Preferred height (same units convention as w). */
  h?: number;
  /** Semantic placement hint the shell may honor. */
  hint?: 'default' | 'wide' | 'tall' | 'compact' | 'focus';
}

/**
 * The View itself. The atom that crosses the desktop <-> spatial boundary and
 * the unit an agent opens via the mesh `open_view` surface.
 */
export interface View {
  /** Stable id. Used to address the view across open/close/focus + sessions. */
  id: string;
  /** Discriminator → which renderer handles it. */
  type: ViewType;
  /** Human-readable title (tab label / panel caption). */
  title?: string;
  /** Where the content comes from. */
  source: ViewSource;
  /** Optional layout hint. */
  layout?: ViewLayout;
  /** Opaque per-view metadata. Hosts/renderers may read; the contract ignores it. */
  meta?: Record<string, unknown>;
}

/**
 * The mesh-resident viewer session — the shared, canonical set of open Views
 * held on the Lattice mesh (node `viewer_session`). It is the seam that makes
 * cross-device handoff possible: each shell tracks its own open views locally,
 * but the session is the one set both agree on, so an agent can move a whole
 * workspace from desktop to Vision Pro (or back) with a single `session_handoff`
 * call. This is the shape `session_get` returns and `session_set` accepts.
 *
 * Mirror of the Python node's in-memory state (viewer-core/session). The node
 * itself is Python; this type lets TS callers describe the shape they read.
 */
export interface Session {
  /** The canonical open-View set. Addressed by `View.id`. */
  views: View[];
  /** Id of the currently-focused View, if any. */
  focused?: string;
  /** ISO-8601 timestamp of the last mutation. */
  updated: string;
}

/**
 * Resolved data handed to a renderer. The host resolves `View.source` into this
 * shape before calling the renderer. Keeping resolution out of renderers is what
 * makes them platform-agnostic and trivially testable.
 */
export interface ResolvedViewData {
  /** The raw content as text (renderers parse as needed). For images/html the host may pass a URL here. */
  content: string;
  /** True when `content` is actually a URL to fetch rather than inline bytes. */
  isUrl?: boolean;
  /** Echo of the source mediaType, if any. */
  mediaType?: string;
}
