/**
 * viewer_desktop — the Lattice mesh node hosted inside the Electron main process.
 *
 * Exposes the five shared viewer surfaces (open_view, close_view, focus_view,
 * list_views, notify — see viewer-core/mesh/viewer-surfaces.json) and translates
 * each into the renderer control actions defined in src/utils/controlBridge.ts,
 * dispatched through the shared `executeViewerControl` seam (viewerControl.ts).
 *
 * The handlers are pure functions of an Envelope + an injected `dispatch`, so
 * they are unit-testable with synthetic envelopes and a mocked dispatch
 * (see viewerNode.test.ts) without standing up Electron or a live Core.
 *
 * NOTE: this node is the intended replacement for the :7434 ControlServer. The
 * control server is kept running in parallel this wave; Wave 4 decides its
 * retirement once mesh integration is proven end-to-end.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { MeshDeny, MeshNode, type Envelope } from '@aether/mesh-node-sdk'
import type { ControlDispatch } from './viewerControl'
import { getGenerator, listGenerators, runGenerator, type View, type ViewType } from '@viewer/core'

const execFileP = promisify(execFile)

export const VIEWER_NODE_ID = 'viewer_desktop'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

/**
 * Maps a shared content {@link ViewType} to the desktop app that hosts it (the
 * app mounts the Wave-1 ContentHost with the matching renderer) plus a file
 * extension used when an inline/`value` source must be materialised to disk.
 */
const TYPE_TO_APP: Record<ViewType, { appId: string; ext: string }> = {
  markdown: { appId: 'markdown-viewer', ext: 'md' },
  text: { appId: 'text-viewer', ext: 'txt' },
  json: { appId: 'json-viewer', ext: 'json' },
  mermaid: { appId: 'mermaid-viewer', ext: 'mmd' },
  kanban: { appId: 'kanban-board', ext: 'kanban' },
  'knowledge-graph': { appId: 'knowledge-graph', ext: 'mindmap' },
  image: { appId: 'image-viewer', ext: 'png' },
  html: { appId: 'html-preview', ext: 'html' },
  latex: { appId: 'latex-viewer', ext: 'tex' },
  // No dedicated desktop table app yet; text-viewer shows the raw CSV/TSV.
  table: { appId: 'text-viewer', ext: 'csv' },
}

interface TrackedView {
  windowId: string
  view: View
  /** The agent that opened this view (env.from at open_view time). The target a
   *  view_event is emitted back to when the human interacts with the view. */
  openedBy: string
}

/** The action enum the view_event surface accepts (v1 — see
 *  viewer-core/mesh/view_event.payload.json). Permissive: an unknown action is
 *  still emitted, the agent decides what to do with it. */
export type ViewEventAction =
  | 'card_moved'
  | 'card_edited'
  | 'node_moved'
  | 'checkbox_toggled'
  | 'cell_edited'
  | (string & {})

interface GetStateWindow {
  id?: string
  title?: string
  zIndex?: number
  isMinimized?: boolean
  isMaximized?: boolean
  position?: { x: number; y: number }
  size?: { width: number; height: number }
  activeTabId?: string
  tabs?: Array<{ id?: string; title?: string; filePath?: string; appId?: string; isActive?: boolean }>
}

interface GetStateWorkspace {
  id?: string
  name?: string
  rootDir?: string
  isActive?: boolean
  windows?: GetStateWindow[]
}

interface GetStateResult {
  workspaces?: GetStateWorkspace[]
  activeWorkspaceId?: string
}

function sanitizeIdForFilename(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 64)
  return cleaned.length > 0 ? cleaned : 'view'
}

// AppleScript strings are double-quoted; backslashes and quotes must be escaped
// before interpolation. execFile keeps /bin/sh out of the loop. Mirrors the
// host_notifications node's escaping.
function escapeApplescriptString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function defaultNotifier(level: string, text: string): Promise<void> {
  if (process.platform !== 'darwin') return
  const title = level === 'error' ? 'Viewer — Error' : level === 'warn' ? 'Viewer — Warning' : 'Viewer'
  const sound = level === 'error' || level === 'warn' ? ' sound name "Glass"' : ''
  const script = `display notification "${escapeApplescriptString(text)}" with title "${escapeApplescriptString(title)}"${sound}`
  await execFileP('osascript', ['-e', script])
}

export interface ViewerNodeDeps {
  /** Reaches the renderer control bridge. Injected so handlers stay testable. */
  dispatch: ControlDispatch
  /** Mesh identity secret. Required to `start()`; handlers don't need it. */
  secret?: string
  coreUrl?: string
  /** Surfaces a transient message to the user. Defaults to an osascript toast. */
  notifier?: (level: string, text: string) => Promise<void>
  /**
   * Emits a fire-and-forget invocation back to a target agent — the SEND half of
   * view_event. Injected (mirroring `dispatch`/`notifier`) so emitViewEvent stays
   * unit-testable with a mock. The default uses the live MeshNode created in
   * `start()`: `node.invoke(target, payload, { wait: false })`.
   */
  meshEmit?: (target: string, payload: Record<string, unknown>) => Promise<void>
  /**
   * Returns the open workspace root, or null if no workspace is open. Inline
   * `open_view` sources are materialized to a temp file the renderer reads via
   * the sandboxed `fs:readFile`, which only allows paths inside this root. When
   * a root is present, inline temp files are written under `<root>/.viewer-tmp/`
   * so they pass the sandbox; otherwise we fall back to os.tmpdir() (the path
   * read will be denied if the sandbox is active, but this keeps tests — which
   * don't open a workspace — working unchanged).
   */
  getRootDir?: () => string | null
}

export interface ViewerNode {
  readonly handlers: {
    open_view: (env: Envelope) => Promise<Record<string, unknown>>
    open_app: (env: Envelope) => Promise<Record<string, unknown>>
    list_apps: (env: Envelope) => Promise<Record<string, unknown>>
    run_generator: (env: Envelope) => Promise<Record<string, unknown>>
    list_generators: (env: Envelope) => Promise<Record<string, unknown>>
    close_view: (env: Envelope) => Promise<Record<string, unknown>>
    focus_view: (env: Envelope) => Promise<Record<string, unknown>>
    list_views: (env: Envelope) => Promise<Record<string, unknown>>
    list_windows: (env: Envelope) => Promise<Record<string, unknown>>
    close_window: (env: Envelope) => Promise<Record<string, unknown>>
    focus_window: (env: Envelope) => Promise<Record<string, unknown>>
    notify: (env: Envelope) => Promise<void>
  }
  /**
   * The SEND half of view_event: the human touched view `viewId`, so emit a
   * fire-and-forget invocation to the agent that opened it. Untracked viewId or a
   * view with no opener drops silently (never throws — a gesture must not crash).
   */
  emitViewEvent: (viewId: string, action: ViewEventAction, data?: Record<string, unknown>) => Promise<void>
  /** windowId-keyed convenience over {@link emitViewEvent}: the renderer knows its
   *  windowId (AppProps), not the agent-assigned View.id, so the shell resolves it. */
  emitViewEventForWindow: (windowId: string, action: ViewEventAction, data?: Record<string, unknown>) => Promise<void>
  start: () => Promise<MeshNode>
  stop: () => Promise<void>
}

export function createViewerNode(deps: ViewerNodeDeps): ViewerNode {
  const dispatch = deps.dispatch
  const notify = deps.notifier ?? defaultNotifier
  const tracked = new Map<string, TrackedView>()
  let node: MeshNode | null = null

  // Default SEND path: a 202 fire_and_forget back to the opening agent. No-op
  // until the node is started (a gesture before the mesh is live just drops).
  const meshEmit =
    deps.meshEmit ??
    (async (target: string, payload: Record<string, unknown>): Promise<void> => {
      if (!node) return
      await node.invoke(target, payload, { wait: false })
    })

  /** Resolve a View's source into a filesystem path the ContentHost can read. */
  async function resolveSourceToPath(view: View, ext: string): Promise<string> {
    const source = view.source
    if (source.kind === 'path') return source.value
    if (source.kind === 'inline') {
      // Materialize inline content to a temp file the renderer reads via the
      // sandboxed fs:readFile. That read only permits paths inside the open
      // workspace root, so when a root is present we stage under
      // <root>/.viewer-tmp/ to pass the sandbox; otherwise fall back to
      // os.tmpdir() (preserves prior behavior when no workspace is open).
      const root = deps.getRootDir?.() ?? null
      let dir: string
      if (root) {
        dir = join(root, '.viewer-tmp')
        await mkdir(dir, { recursive: true })
      } else {
        dir = await mkdtemp(join(tmpdir(), 'viewer-view-'))
      }
      const file = join(dir, `${sanitizeIdForFilename(view.id)}.${ext}`)
      await writeFile(file, source.value, 'utf8')
      return file
    }
    // url: desktop resolves sources via the local fs (see mesh/README.md mapping
    // table); fetching a remote URL into a window is a follow-up wave.
    throw new MeshDeny('viewer_url_source_unsupported', {
      id: view.id,
      kind: source.kind,
      hint: 'desktop currently hosts path + inline sources; url is a follow-up',
    })
  }

  async function openView(env: Envelope): Promise<Record<string, unknown>> {
    const view = env.payload as Partial<View>
    if (typeof view.id !== 'string' || typeof view.type !== 'string' || view.source == null) {
      throw new MeshDeny('viewer_bad_payload', {
        have: { id: typeof view.id, type: typeof view.type, source: typeof view.source },
      })
    }
    // Reject id reuse up front. Silently overwriting tracked[id] would orphan
    // the previous window — it stays open but drops out of the map, so it can
    // never be closed/focused again. Make the agent close_view first (or pick a
    // fresh id); a stateless agent after a context reset should call list_views.
    if (tracked.has(view.id)) {
      throw new MeshDeny('viewer_id_in_use', { id: view.id })
    }
    const mapping = TYPE_TO_APP[view.type as ViewType]
    if (!mapping) {
      throw new MeshDeny('viewer_unknown_view_type', { type: view.type })
    }
    const path = await resolveSourceToPath(view as View, mapping.ext)
    const result = (await dispatch('open-file', { path, appId: mapping.appId })) as {
      windowId?: string
      error?: string
    }
    if (!result || typeof result.windowId !== 'string') {
      throw new MeshDeny('viewer_open_failed', { id: view.id, detail: result?.error ?? 'no windowId' })
    }
    // Capture the opener (env.from) so a later human interaction can be routed
    // back to the agent that painted this view. run_generator-opened views reuse
    // the envelope, so openedBy flows through to them unchanged.
    tracked.set(view.id, { windowId: result.windowId, view: view as View, openedBy: env.from })
    return { ok: true, id: view.id }
  }

  // The declarative-authoring symmetry of spatial's `POST /generators/{slug}/run`:
  // resolve `slug` in the shared @viewer/core registry, run it to a View[] (which
  // `runGenerator` validates), then open every emitted View through the SAME
  // openView seam. Same generator code, same View contract, driven over the mesh.
  async function runGeneratorHandler(env: Envelope): Promise<Record<string, unknown>> {
    const payload = env.payload as { slug?: string; params?: unknown }
    if (typeof payload.slug !== 'string' || payload.slug.length === 0) {
      throw new MeshDeny('viewer_bad_payload', { have: { slug: typeof payload.slug } })
    }
    const entry = getGenerator(payload.slug)
    if (!entry) throw new MeshDeny('viewer_unknown_generator', { slug: payload.slug })
    let views: View[]
    try {
      views = runGenerator(entry, payload.params ?? {})
    } catch (e) {
      throw new MeshDeny('viewer_generator_failed', { slug: payload.slug, detail: (e as Error).message })
    }
    const opened: string[] = []
    for (const view of views) {
      // openView reads env.payload as a View; reuse the envelope (from/
      // correlation_id) so a generator-opened view stays auditable.
      await openView({ ...env, payload: view as unknown as Record<string, unknown> })
      opened.push(view.id)
    }
    return { ok: true, slug: payload.slug, opened, count: opened.length }
  }

  // The discovery half of run_generator: reflect the shared @viewer/core
  // registry so an agent can see WHICH generators exist before calling
  // run_generator. Projects each entry to its addressable surface (slug +
  // describe + advisory paramsSchema) and NEVER leaks the `generate` function.
  async function listGeneratorsHandler(_env: Envelope): Promise<Record<string, unknown>> {
    const generators = listGenerators().map((g) => ({
      slug: g.slug,
      describe: g.describe,
      paramsSchema: g.paramsSchema,
    }))
    return { ok: true, generators }
  }

  async function closeView(env: Envelope): Promise<Record<string, unknown>> {
    const id = (env.payload as { id?: string }).id
    if (typeof id !== 'string') throw new MeshDeny('viewer_bad_payload', { have: { id: typeof id } })
    const entry = tracked.get(id)
    if (!entry) throw new MeshDeny('viewer_unknown_view', { id })
    await dispatch('close-window', { windowId: entry.windowId })
    tracked.delete(id)
    return { ok: true }
  }

  async function focusView(env: Envelope): Promise<Record<string, unknown>> {
    const id = (env.payload as { id?: string }).id
    if (typeof id !== 'string') throw new MeshDeny('viewer_bad_payload', { have: { id: typeof id } })
    const entry = tracked.get(id)
    if (!entry) throw new MeshDeny('viewer_unknown_view', { id })
    await dispatch('focus-window', { windowId: entry.windowId })
    return { ok: true }
  }

  async function listViews(_env: Envelope): Promise<Record<string, unknown>> {
    const state = (await dispatch('get-state', {})) as GetStateResult
    const liveZ = new Map<string, number>()
    for (const ws of state.workspaces ?? []) {
      for (const win of ws.windows ?? []) {
        if (typeof win.id === 'string') liveZ.set(win.id, win.zIndex ?? 0)
      }
    }
    const views: View[] = []
    let focused: string | undefined
    let topZ = -Infinity
    for (const [id, entry] of tracked) {
      if (!liveZ.has(entry.windowId)) {
        // Window was closed out-of-band (e.g. user clicked the close button).
        tracked.delete(id)
        continue
      }
      views.push(entry.view)
      const z = liveZ.get(entry.windowId) ?? 0
      if (z > topZ) {
        topZ = z
        focused = id
      }
    }
    return focused ? { views, focused } : { views }
  }

  // Full-scene surfaces. Where list_views/close_view/focus_view operate ONLY on
  // the `tracked` map (views this node painted), these operate on the ENTIRE
  // window set — every window in every workspace, regardless of who opened it
  // (the user, a different agent, or this node). They are the agent's eyes and
  // hands over the whole desktop scene, fixing the config-vs-mesh blind spot
  // where user-opened / restored windows were invisible to list_views.
  async function listWindows(_env: Envelope): Promise<Record<string, unknown>> {
    const state = (await dispatch('get-state', {})) as GetStateResult
    // Reverse-index tracked windowId -> view id so the snapshot can flag which
    // windows this node is responsible for (useful for an agent reconciling its
    // own painted views against the full scene).
    const ownView = new Map<string, string>()
    for (const [viewId, entry] of tracked) ownView.set(entry.windowId, viewId)
    const windows: Array<Record<string, unknown>> = []
    for (const ws of state.workspaces ?? []) {
      for (const win of ws.windows ?? []) {
        if (typeof win.id !== 'string') continue
        const activeTab = (win.tabs ?? []).find((t) => t.id === win.activeTabId) ?? (win.tabs ?? [])[0]
        windows.push({
          id: win.id,
          title: win.title ?? null,
          appId: activeTab?.appId ?? null,
          filePath: activeTab?.filePath ?? null,
          workspaceId: ws.id ?? null,
          workspaceName: ws.name ?? null,
          isMinimized: win.isMinimized ?? false,
          isMaximized: win.isMaximized ?? false,
          zIndex: win.zIndex ?? 0,
          position: win.position ?? null,
          size: win.size ?? null,
          tabCount: (win.tabs ?? []).length,
          viewId: ownView.get(win.id) ?? null,
        })
      }
    }
    windows.sort((a, b) => (b.zIndex as number) - (a.zIndex as number))
    return { ok: true, windows, count: windows.length, activeWorkspaceId: state.activeWorkspaceId ?? null }
  }

  async function closeWindow(env: Envelope): Promise<Record<string, unknown>> {
    const windowId = (env.payload as { windowId?: string }).windowId
    if (typeof windowId !== 'string') {
      throw new MeshDeny('viewer_bad_payload', { have: { windowId: typeof windowId } })
    }
    await dispatch('close-window', { windowId })
    // If this window happened to back a tracked view, drop it from the map so
    // list_views stays consistent with the now-closed window.
    for (const [viewId, entry] of tracked) {
      if (entry.windowId === windowId) {
        tracked.delete(viewId)
        break
      }
    }
    return { ok: true, windowId }
  }

  async function focusWindow(env: Envelope): Promise<Record<string, unknown>> {
    const windowId = (env.payload as { windowId?: string }).windowId
    if (typeof windowId !== 'string') {
      throw new MeshDeny('viewer_bad_payload', { have: { windowId: typeof windowId } })
    }
    await dispatch('focus-window', { windowId })
    return { ok: true, windowId }
  }

  // Open a *registered app* (not a file-backed View) in a new window — the
  // "open my apps" surface. Aether's voice/console path to "open the mesh app",
  // "open a terminal", etc. Dispatches the renderer's open-app control action.
  async function openApp(env: Envelope): Promise<Record<string, unknown>> {
    const payload = env.payload as { appId?: string; title?: string }
    if (typeof payload.appId !== 'string' || payload.appId.length === 0) {
      throw new MeshDeny('viewer_bad_payload', { have: { appId: typeof payload.appId } })
    }
    const result = (await dispatch('open-app', { appId: payload.appId, title: payload.title })) as {
      windowId?: string
      appId?: string
      error?: string
    }
    if (!result || typeof result.windowId !== 'string') {
      throw new MeshDeny('viewer_open_failed', { appId: payload.appId, detail: result?.error ?? 'no windowId' })
    }
    return { ok: true, appId: payload.appId, windowId: result.windowId }
  }

  // Discovery half of open_app: reflect the renderer's app registry so an agent
  // can see WHICH apps exist (ids + names + icons) before opening one.
  async function listApps(_env: Envelope): Promise<Record<string, unknown>> {
    const apps = (await dispatch('get-apps', {})) as unknown[]
    return { ok: true, apps: Array.isArray(apps) ? apps : [] }
  }

  async function notifyHandler(env: Envelope): Promise<void> {
    const payload = env.payload as { level?: string; text?: string }
    if (typeof payload.text !== 'string' || payload.text.length === 0) return
    const level = payload.level === 'warn' || payload.level === 'error' ? payload.level : 'info'
    try {
      await notify(level, payload.text)
    } catch {
      // Fire-and-forget: a toast either shows or it doesn't; never surface back.
    }
  }

  // view_event is NOT a surface on this node — the viewer node is the SENDER. The
  // event flows on the existing mesh via the captured `openedBy`, emitted as a
  // fresh fire_and_forget invocation to { to: openedBy, surface: 'view_event' }.
  async function emitViewEvent(
    viewId: string,
    action: ViewEventAction,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    const entry = tracked.get(viewId)
    // Untracked view or no recorded opener: drop silently. A stray gesture (e.g.
    // a window closed out-of-band, or a view opened before openedBy existed) must
    // never crash the interaction path.
    if (!entry || !entry.openedBy) return
    const payload = {
      viewId,
      type: entry.view.type,
      action,
      data,
      ts: new Date().toISOString(),
    }
    try {
      await meshEmit(entry.openedBy, payload)
    } catch {
      // Fire-and-forget: the human's gesture already happened locally; a failed
      // emit must not surface back as an error.
    }
  }

  async function emitViewEventForWindow(
    windowId: string,
    action: ViewEventAction,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    for (const [id, entry] of tracked) {
      if (entry.windowId === windowId) {
        await emitViewEvent(id, action, data)
        return
      }
    }
    // No tracked view for this window: drop silently (same contract as above).
  }

  async function start(): Promise<MeshNode> {
    if (!deps.secret) {
      throw new Error(`[${VIEWER_NODE_ID}] secret is required to start (set VIEWER_MESH_SECRET)`)
    }
    const n = new MeshNode(VIEWER_NODE_ID, deps.secret, deps.coreUrl ?? CORE_URL)
    n.on('open_view', openView)
    n.on('open_app', openApp)
    n.on('list_apps', listApps)
    n.on('run_generator', runGeneratorHandler)
    n.on('list_generators', listGeneratorsHandler)
    n.on('close_view', closeView)
    n.on('focus_view', focusView)
    n.on('list_views', listViews)
    n.on('list_windows', listWindows)
    n.on('close_window', closeWindow)
    n.on('focus_window', focusWindow)
    n.on('notify', notifyHandler)
    await n.start()
    node = n
    return n
  }

  async function stop(): Promise<void> {
    if (node) {
      await node.stop()
      node = null
    }
  }

  return {
    handlers: {
      open_view: openView,
      open_app: openApp,
      list_apps: listApps,
      run_generator: runGeneratorHandler,
      list_generators: listGeneratorsHandler,
      close_view: closeView,
      focus_view: focusView,
      list_views: listViews,
      list_windows: listWindows,
      close_window: closeWindow,
      focus_window: focusWindow,
      notify: notifyHandler,
    },
    emitViewEvent,
    emitViewEventForWindow,
    start,
    stop,
  }
}
