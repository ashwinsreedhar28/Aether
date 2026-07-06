/**
 * Control Bridge
 * Exposes Zustand store actions to the Electron main process via window.__viewerControl.
 * The control server calls these actions via mainWindow.webContents.executeJavaScript().
 */

import { getDesktopContainerSize, useWorkspaceStore } from '../stores/workspaceStore';
import { useSpawnUi } from '../stores/spawnUi';
import { matchSpawnRecord } from './spawnMatch';
import { isRegion, REGIONS, resolveRegion } from './regionResolver';
import { getAppForFile, getApps } from '../apps';

type ActionHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

const handlers: Record<string, ActionHandler> = {
  'get-state': () => {
    const store = useWorkspaceStore.getState();
    return {
      workspaces: store.workspaces.map(w => ({
        id: w.id,
        rootDir: w.rootDir,
        name: w.name,
        isActive: w.id === store.activeWorkspaceId,
        windows: w.windows.map(win => ({
          id: win.id,
          title: win.title,
          isMinimized: win.isMinimized,
          isMaximized: win.isMaximized,
          position: win.position,
          size: win.size,
          zIndex: win.zIndex,
          tabs: (win.tabs || []).map(t => ({
            id: t.id,
            title: t.title,
            filePath: t.filePath,
            appId: t.appId,
            isActive: t.isActive,
            isDirty: t.isDirty,
          })),
          activeTabId: win.activeTabId,
        })),
      })),
      activeWorkspaceId: store.activeWorkspaceId,
    };
  },

  'get-apps': () => {
    const apps = getApps();
    return apps.map(a => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      fileTypes: a.fileTypes || [],
      defaultSize: a.defaultSize || { width: 600, height: 500 },
    }));
  },

  'open-file': (params: Record<string, unknown>) => {
    const filePath = params.path as string;
    const forceAppId = params.appId as string | undefined;
    const targetWindowId = params.windowId as string | undefined;

    const store = useWorkspaceStore.getState();
    const workspace = store.getActiveWorkspace();
    if (!workspace) return { error: 'No active workspace' };

    // Check if file is already open in a tab
    for (const win of workspace.windows) {
      const existing = (win.tabs || []).find(t => t.filePath === filePath);
      if (existing) {
        store.switchTab(win.id, existing.id);
        store.focusWindow(win.id);
        return { windowId: win.id, tabId: existing.id, alreadyOpen: true };
      }
    }

    // Determine which app to use
    const appDef = forceAppId ? undefined : getAppForFile(filePath);
    const appId = forceAppId || appDef?.id || 'text-editor';
    const fileName = filePath.split('/').pop() || 'Untitled';
    const defaultSize = appDef?.defaultSize || { width: 600, height: 500 };

    if (targetWindowId) {
      // Add as tab to specified window (--tab mode)
      const tabId = store.addTab(targetWindowId, filePath, appId, fileName);
      store.focusWindow(targetWindowId);
      return { windowId: targetWindowId, tabId, appId };
    }

    // Default: open in a new window (each file gets its own display)
    const offset = workspace.windows.length * 30;
    const windowId = store.openWindow({
      title: fileName,
      appId,
      filePath,
      position: { x: 150 + offset, y: 80 + offset },
      size: defaultSize,
      isMinimized: false,
      isMaximized: false,
    });
    return { windowId, appId };
  },

  'open-files': (params: Record<string, unknown>) => {
    const paths = params.paths as string[];
    const windowId = params.windowId as string | undefined;
    const results: unknown[] = [];
    const errors: string[] = [];

    const openFile = handlers['open-file'];
    for (const p of paths) {
      try {
        const result = openFile?.({ path: p, windowId });
        results.push(result);
      } catch (err) {
        errors.push(`${p}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { opened: results, errors };
  },

  'open-app': async (params: Record<string, unknown>) => {
    const appId = params.appId as string;
    const title = (params.title as string) || appId;
    const store = useWorkspaceStore.getState();

    const apps = getApps();
    const appDef = apps.find(a => a.id === appId);
    // Unknown id: return the registry instead of silently creating a
    // tabless blank window. The error payload flows back through the
    // viewer_desktop node to the calling agent, which can resolve the
    // right id from `available` and retry without a round-trip to the
    // user.
    if (!appDef) {
      return { error: `unknown app id '${appId}'`, available: apps.map(a => a.id) };
    }
    // Terminal is not a plain registry app: its tab's filePath must be a
    // live PTY sessionId (the Terminal component attaches to it), so it
    // has to go through openTerminal — the same path the manual launcher
    // uses. Opening it like a generic app yields a dead, shell-less
    // window.
    if (appId === 'terminal') {
      const result = await store.openTerminal(undefined, params.cwd as string | undefined);
      if (!result) {
        return { error: 'terminal create failed (no active workspace or PTY spawn error)' };
      }
      return { windowId: result.windowId, appId };
    }
    const defaultSize = appDef.defaultSize || { width: 600, height: 500 };

    const windowId = store.openWindow({
      title,
      appId,
      // Standalone apps use the appId as a stable filePath identity — the same
      // convention the Cmd+P SearchModal uses. It's load-bearing: openWindow
      // only materializes a tab when BOTH filePath and appId are truthy. Passing
      // '' here left the window tabless → blank (the bug Raven hit opening apps,
      // while Cmd+P worked because it sets filePath = appId).
      filePath: appId,
      position: { x: 150 + Math.random() * 100, y: 80 + Math.random() * 100 },
      size: defaultSize,
      isMinimized: false,
      isMaximized: false,
    });
    return { windowId, appId };
  },

  'close-window': (params: Record<string, unknown>) => {
    const windowId = params.windowId as string;
    useWorkspaceStore.getState().closeWindow(windowId);
    return { success: true };
  },

  'close-tab': (params: Record<string, unknown>) => {
    const windowId = params.windowId as string;
    const tabId = params.tabId as string;
    useWorkspaceStore.getState().removeTab(windowId, tabId);
    return { success: true };
  },

  'focus-window': (params: Record<string, unknown>) => {
    const windowId = params.windowId as string;
    useWorkspaceStore.getState().focusWindow(windowId);
    return { success: true };
  },

  'open-workspace': async (params: Record<string, unknown>) => {
    const rootDir = params.path as string;
    const id = await useWorkspaceStore.getState().openWorkspace(rootDir);
    return { workspaceId: id };
  },

  'switch-workspace': (params: Record<string, unknown>) => {
    const id = params.id as string;
    useWorkspaceStore.getState().switchWorkspace(id);
    return { success: true };
  },

  'list-workspaces': () => {
    const store = useWorkspaceStore.getState();
    return store.workspaces.map(w => ({
      id: w.id,
      rootDir: w.rootDir,
      name: w.name,
      isActive: w.id === store.activeWorkspaceId,
      windowCount: w.windows.length,
    }));
  },

  'open-terminal': async (params: Record<string, unknown>) => {
    const windowId = params.windowId as string | undefined;
    const cwd = params.cwd as string | undefined;
    await useWorkspaceStore.getState().openTerminal(windowId, cwd);
    return { success: true };
  },

  'terminal-write': async (params: Record<string, unknown>) => {
    const sessionId = params.sessionId as string;
    const data = params.data as string;
    return await window.electron.terminal.write(sessionId, data);
  },

  // Lane terminals (#268): open a named terminal window in the worktree and
  // run one command in it — `tmux attach -t lane-N` (or the claude invocation
  // directly on the pty fallback). One atomic action so the SpawnService
  // never has to round-trip a sessionId across the bridge.
  'open-lane-terminal': async (params: Record<string, unknown>) => {
    const cwd = params.cwd as string | undefined;
    const command = params.command as string;
    const title = params.title as string | undefined;
    if (!command) return { ok: false, error: 'missing command' };
    const store = useWorkspaceStore.getState();
    const result = await store.openTerminal(undefined, cwd, title);
    if (!result) {
      return { ok: false, error: 'terminal create failed (no active workspace or PTY spawn error)' };
    }
    await window.electron.terminal.write(result.sessionId, command + '\n');
    return { ok: true, windowId: result.windowId, sessionId: result.sessionId };
  },

  // Spawn-card summon (#305): raise the SpawnApproval card for lane N — the
  // voice path behind raven's show_lane_card tool. Resolves the record with
  // the SAME matcher the clickable Lanes rows use (issue number / branch), so
  // a click and "show me lane N's card" agree, then routes through
  // useSpawnUi.open() exactly like a Spawns-strip click (clears any minimize).
  'show-lane-card': async (params: Record<string, unknown>) => {
    const raw = params.number;
    const number =
      typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : null;
    if (number == null) return { ok: false, error: 'bad lane number' };
    const snap = await window.aether.spawn.list();
    const rec = matchSpawnRecord(snap.spawns, { issue: number, branch: `lane/issue-${number}` });
    if (!rec) return { ok: false, error: `no spawn record for lane ${number}` };
    useSpawnUi.getState().open(rec.id);
    return { ok: true, id: rec.id, issue: rec.issue ?? null, status: rec.status };
  },

  'apply-layout': (params: Record<string, unknown>) => {
    const preset = params.preset as string;
    const store = useWorkspaceStore.getState();

    if (preset === 'tile') {
      store.tileWindows();
    } else {
      store.applyLayoutPreset(preset as 'focus' | 'split' | 'thirds' | 'quarters');
    }
    return { success: true };
  },

  // Semantic window placement (#337): put ONE window into a named screen
  // region ('left', 'top-right', 'center-third', …) or explicit pixel bounds.
  // Exactly one of region|bounds. The region grammar resolves through
  // regionResolver against the same container size the layout presets use;
  // explicit bounds are the escape hatch, never the default (see ADR
  // 2026-07-06-semantic-region-grammar). Every refusal is named — the error
  // payload flows back to the calling agent (open-app precedent), so an
  // unknown region carries the full grammar for in-turn recovery.
  'place-window': (params: Record<string, unknown>) => {
    const target = params.target;
    const region = params.region;
    const bounds = params.bounds as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | undefined;

    if (typeof target !== 'string' || target.length === 0) {
      return { error: 'target (a windowId or appId) is required' };
    }
    if ((region !== undefined) === (bounds !== undefined)) {
      return { error: 'exactly one of region | bounds is required' };
    }

    const store = useWorkspaceStore.getState();
    const workspace = store.getActiveWorkspace();
    if (!workspace) return { error: 'No active workspace' };

    // Resolve target: exact windowId first, else the topmost window hosting a
    // tab of that appId (voice says "the browser", not a window id).
    let win = workspace.windows.find(w => w.id === target);
    if (!win) {
      win = workspace.windows
        .filter(w => (w.tabs || []).some(t => t.appId === target))
        .sort((a, b) => b.zIndex - a.zIndex)[0];
    }
    if (!win) {
      return { error: `no open window for target '${target}'` };
    }

    let resolved: { x: number; y: number; width: number; height: number };
    if (region !== undefined) {
      if (typeof region !== 'string' || !isRegion(region)) {
        return { error: `unknown region '${String(region)}'`, regions: [...REGIONS] };
      }
      resolved = resolveRegion(region, getDesktopContainerSize(store.workspaces.length));
    } else {
      const { x, y, width, height } = bounds ?? {};
      if (
        typeof x !== 'number' || typeof y !== 'number' ||
        typeof width !== 'number' || typeof height !== 'number' ||
        !Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0
      ) {
        return { error: 'bounds must be { x, y, width, height } numbers with positive width and height' };
      }
      resolved = { x, y, width, height };
    }

    store.setWindowBounds(win.id, resolved);
    return {
      ok: true,
      windowId: win.id,
      ...(typeof region === 'string' ? { region } : {}),
      bounds: resolved,
    };
  },
};

/**
 * Initialize the control bridge by registering the __viewerControl object on window.
 * Call this once during app startup after stores are ready.
 */
export function initControlBridge(): void {
  (window as unknown as Record<string, unknown>).__viewerControl = {
    // Never reject (#300): a rejected promise crossing executeJavaScript can
    // leave the main-process caller pending FOREVER — the spawn recipe hung
    // exactly there on an unanswered open-lane-terminal. Every failure
    // (unknown action included) resolves as a { __controlError } envelope;
    // executeViewerControl re-throws it main-side, so callers still get a
    // rejection, deterministically.
    execute: async (action: string, params: Record<string, unknown> = {}) => {
      try {
        const handler = handlers[action];
        if (!handler) {
          return { __controlError: `Unknown control action: ${action}` };
        }
        return await handler(params);
      } catch (err) {
        return { __controlError: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  // Notify main process that the bridge is ready
  window.electron.control.bridgeReady();
}
