import { useEffect, useState, type ReactNode } from 'react';
import { Desktop } from './components/Desktop';
import { Welcome } from './components/Welcome';
import { WorkspaceTabs } from './components/WorkspaceTabs';
import { LeapControllerLayer } from './components/Leap/LeapControllerLayer';
import { CommandPalette } from './components/CommandPalette';
import { DictationOverlay } from './components/DictationOverlay';
import { useWorkspaceStore } from './stores/workspaceStore';
import { useSettingsStore } from './stores/settingsStore';
import { initControlBridge } from './utils/controlBridge';

function App() {
  const workspaces = useWorkspaceStore(s => s.workspaces);
  const loadConfig = useWorkspaceStore(s => s.loadConfig);
  const configLoaded = useWorkspaceStore(s => s.configLoaded);
  const openWorkspace = useWorkspaceStore(s => s.openWorkspace);
  const loadSettings = useSettingsStore(s => s.loadSettings);
  const applyTheme = useSettingsStore(s => s.applyTheme);
  const [showClaudePalette, setShowClaudePalette] = useState(false);
  const [claudeProcessing, setClaudeProcessing] = useState(false);

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Initialize control bridge for CLI/agent control
  useEffect(() => {
    if (configLoaded) {
      initControlBridge();
    }
  }, [configLoaded]);

  // Load and apply theme on mount
  useEffect(() => {
    loadSettings().then(() => {
      applyTheme();
    });
  }, [loadSettings, applyTheme]);

  // Listen for initial folder from CLI
  useEffect(() => {
    const unsubscribe = window.electron.app.onInitialFolder((path) => {
      openWorkspace(path);
    });
    return () => unsubscribe();
  }, [openWorkspace]);

  // Listen for folder opened from menu
  useEffect(() => {
    const unsubscribe = window.electron.app.onRootDirChanged((path) => {
      openWorkspace(path);
    });
    return () => unsubscribe();
  }, [openWorkspace]);

  // Listen for Claude palette menu event
  useEffect(() => {
    const unsubscribe = window.electron.app.onMenuOpenClaudePalette(() => {
      setShowClaudePalette(prev => !prev);
    });
    return () => unsubscribe();
  }, []);

  let content: ReactNode;

  // Show loading state while config loads
  if (!configLoaded) {
    content = (
      <div className="w-full h-full flex items-center justify-center bg-[var(--holo-bg)]">
        <div className="text-center text-[var(--holo-muted)]">
          <div className="text-lg" style={{ fontFamily: 'DepartureMono, monospace' }}>R.A.V.E.N.</div>
          <div className="text-sm mt-2">Loading...</div>
        </div>
      </div>
    );
  } else if (workspaces.length === 0) {
    // Show welcome screen if no workspaces
    content = <Welcome />;
  } else {
    // Show workspace with tabs
    content = (
      <div className="w-full h-full flex flex-col overflow-hidden bg-[var(--holo-bg)]">
        {/* Workspace tabs - only show if more than one workspace */}
        {workspaces.length > 1 && <WorkspaceTabs />}

        {/* Desktop - renders all workspaces, only active one is visible */}
        {/* Each workspace gets its own Desktop instance that persists across switches */}
        {workspaces.map(workspace => (
          <Desktop key={workspace.id} workspaceId={workspace.id} />
        ))}
      </div>
    );
  }

  return (
    <>
      {content}
      <LeapControllerLayer />
      <DictationOverlay />
      <CommandPalette
        isVisible={showClaudePalette}
        onClose={() => setShowClaudePalette(false)}
        onProcessingChange={setClaudeProcessing}
      />
      {!showClaudePalette && claudeProcessing && (
        <div
          onClick={() => setShowClaudePalette(true)}
          className="fixed bottom-0 left-0 right-0 h-0.5 z-[9998] cursor-pointer overflow-hidden"
        >
          <div className="h-full w-full bg-blue-500 animate-[shimmer_1.5s_ease-in-out_infinite]"
            style={{
              background: 'linear-gradient(90deg, transparent 0%, #3b82f6 50%, transparent 100%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 4s ease-in-out infinite',
            }}
          />
        </div>
      )}
    </>
  );
}

export default App;
