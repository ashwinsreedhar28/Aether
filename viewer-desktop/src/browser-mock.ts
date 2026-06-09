// Browser mock for Electron APIs - allows the app to run in browser mode for testing/exploration
// This provides stub implementations that allow the UI to render without crashing

const noopPromise = () => Promise.resolve();
const noopUnsubscribe = () => () => {};

// Check if we're in a browser (not Electron)
const isBrowser = typeof window !== 'undefined' && !window.electron;

if (isBrowser) {
  console.log('[Browser Mock] Initializing browser mock for Electron APIs');

  const mockElectron = {
    fs: {
      getTree: () => Promise.resolve({ tree: { name: 'root', path: '/', type: 'directory' as const, modified: new Date().toISOString(), size: 0, children: [] } }),
      getChildren: () => Promise.resolve({ children: [] }),
      watchDir: () => Promise.resolve({ success: true }),
      unwatchDir: () => Promise.resolve({ success: true }),
      readFile: (path: string) => Promise.resolve({ path, content: '// Browser mode - file reading disabled', modified: new Date().toISOString() }),
      writeFile: noopPromise,
      createFile: noopPromise,
      deleteFile: noopPromise,
      rename: noopPromise,
      onChange: noopUnsubscribe,
    },
    app: {
      getRootDir: () => Promise.resolve('/mock/workspace'),
      hasWorkspace: () => Promise.resolve(true),
      setRootDir: (path: string) => Promise.resolve(path),
      openFolderDialog: () => Promise.resolve(null),
      onRootDirChanged: noopUnsubscribe,
      onInitialFolder: noopUnsubscribe,
      onMenuNewTerminal: noopUnsubscribe,
      onMenuCloseWorkspace: noopUnsubscribe,
      onMenuCloseTab: noopUnsubscribe,
      onMenuOpenSearch: noopUnsubscribe,
      onMenuToggleExplorer: noopUnsubscribe,
      onMenuTileWindows: noopUnsubscribe,
      onMenuMaximizeWindow: noopUnsubscribe,
      onMenuPrevTab: noopUnsubscribe,
      onMenuNextTab: noopUnsubscribe,
      onMenuFocusUp: noopUnsubscribe,
      onMenuFocusDown: noopUnsubscribe,
      onMenuFocusLeft: noopUnsubscribe,
      onMenuFocusRight: noopUnsubscribe,
      onMenuNewProject: noopUnsubscribe,
      onMenuLayoutPreset: noopUnsubscribe,
      onMenuOpenClaudePalette: noopUnsubscribe,
    },
    config: {
      load: () => Promise.resolve({
        windows: [],
        expandedDirs: [],
        workspaces: [{
          id: 'browser-mock',
          name: 'Browser Mode',
          rootDir: '/mock/workspace',
          windows: [],
          expandedDirs: [],
        }],
        activeWorkspaceId: 'browser-mock',
      }),
      save: noopPromise,
    },
    terminal: {
      create: () => Promise.resolve({ sessionId: 'mock-terminal', shell: '/bin/bash', cwd: '/mock/workspace' }),
      write: () => Promise.resolve({ success: true }),
      resize: () => Promise.resolve({ success: true }),
      kill: () => Promise.resolve({ success: true }),
      getShells: () => Promise.resolve({ shells: ['/bin/bash', '/bin/zsh'], defaultShell: '/bin/bash' }),
      getSession: () => Promise.resolve(null),
      onData: noopUnsubscribe,
      onExit: noopUnsubscribe,
    },
    browser: {
      openExternal: () => Promise.resolve({ success: true }),
    },
    leap: {
      status: () => Promise.resolve({
        running: false,
        managed: false,
        pid: null,
        path: '/mock/Ultraleap-Tracking-WS',
      }),
      ensureService: () => Promise.resolve({
        running: false,
        managed: false,
        pid: null,
        path: '/mock/Ultraleap-Tracking-WS',
      }),
    },
    mcp: {
      loadSettings: () => Promise.resolve({}),
      listServers: () => Promise.resolve([]),
      getServerStatus: () => Promise.resolve(null),
      startServer: () => Promise.resolve({ id: 'mock', config: { command: '' }, status: 'stopped' as const }),
      stopServer: noopPromise,
      restartServer: () => Promise.resolve({ id: 'mock', config: { command: '' }, status: 'stopped' as const }),
      listTools: () => Promise.resolve([]),
      callTool: () => Promise.resolve(null),
      listResources: () => Promise.resolve([]),
      readResource: () => Promise.resolve(null),
      listPrompts: () => Promise.resolve([]),
      getPrompt: () => Promise.resolve(null),
      sendRaw: noopPromise,
      onStatusChange: noopUnsubscribe,
      onMessage: noopUnsubscribe,
      onNotification: noopUnsubscribe,
    },
    claude: {
      query: () => Promise.resolve({ success: false }),
      abort: () => Promise.resolve({ success: true }),
      getAuthStatus: () => Promise.resolve({ authenticated: false }),
      onStream: noopUnsubscribe,
    },
    control: {
      bridgeReady: noopPromise,
    },
    whisper: {
      setApiKey: () => Promise.resolve({ success: true }),
      transcribe: () => Promise.resolve({ success: false, error: 'Browser mode' }),
      hasApiKey: () => Promise.resolve({ hasKey: false }),
    },
  };

  (window as unknown as Record<string, unknown>).electron = mockElectron;
  console.log('[Browser Mock] Electron APIs mocked successfully');
}

export {};
