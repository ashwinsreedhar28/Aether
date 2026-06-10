import { useState, useEffect } from 'react';
import { Folder, FolderOpen, Clock, Plus, ChevronRight } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore';

export function Welcome() {
  const { recentFolders, openWorkspace, loadConfig, configLoaded } = useWorkspaceStore();
  const [hoveredFolder, setHoveredFolder] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);

  // Load config on mount to get recent folders
  useEffect(() => {
    if (!configLoaded) {
      loadConfig();
    }
  }, [loadConfig, configLoaded]);

  const handleOpenFolder = async () => {
    setIsOpening(true);
    try {
      const result = await window.electron.app.openFolderDialog();
      if (result) {
        await openWorkspace(result.path);
      }
    } finally {
      setIsOpening(false);
    }
  };

  const handleOpenRecent = async (path: string) => {
    setIsOpening(true);
    try {
      await openWorkspace(path);
    } finally {
      setIsOpening(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--holo-bg)] overflow-hidden">
      {/* Background grid pattern */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `
            linear-gradient(rgba(100, 150, 255, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(100, 150, 255, 0.1) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }}
      />

      {/* Animated glow orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute w-96 h-96 rounded-full opacity-10"
          style={{
            background: 'radial-gradient(circle, rgba(100, 150, 255, 0.3) 0%, transparent 70%)',
            top: '10%',
            left: '10%',
            animation: 'float 20s ease-in-out infinite',
          }}
        />
        <div
          className="absolute w-64 h-64 rounded-full opacity-10"
          style={{
            background: 'radial-gradient(circle, rgba(74, 158, 255, 0.3) 0%, transparent 70%)',
            bottom: '20%',
            right: '15%',
            animation: 'float 15s ease-in-out infinite reverse',
          }}
        />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center gap-8 max-w-2xl px-8">
        {/* Logo and branding */}
        <div className="text-center mb-4">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div
              className="w-16 h-16 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, rgba(100, 150, 255, 0.2) 0%, rgba(74, 158, 255, 0.1) 100%)',
                border: '1px solid rgba(100, 150, 255, 0.3)',
                boxShadow: '0 0 30px rgba(100, 150, 255, 0.2)',
              }}
            >
              <FolderOpen size={32} className="text-[var(--holo-accent)]" />
            </div>
          </div>
          <h1
            className="text-4xl font-bold tracking-tight mb-2"
            style={{ fontFamily: 'DepartureMono, monospace', color: 'var(--holo-accent)' }}
          >
            VIEWER
          </h1>
          <p className="text-[var(--holo-muted)] text-sm">
            Your futuristic workspace for any project
          </p>
        </div>

        {/* Open folder button */}
        <button
          onClick={handleOpenFolder}
          disabled={isOpening}
          className="group flex items-center gap-3 px-8 py-4 rounded-lg transition-all duration-200"
          style={{
            background: 'linear-gradient(135deg, rgba(100, 150, 255, 0.15) 0%, rgba(74, 158, 255, 0.1) 100%)',
            border: '1px solid rgba(100, 150, 255, 0.3)',
            boxShadow: '0 0 20px rgba(100, 150, 255, 0.1)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'rgba(100, 150, 255, 0.6)';
            e.currentTarget.style.boxShadow = '0 0 30px rgba(100, 150, 255, 0.25)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'rgba(100, 150, 255, 0.3)';
            e.currentTarget.style.boxShadow = '0 0 20px rgba(100, 150, 255, 0.1)';
          }}
        >
          <Plus size={20} className="text-[var(--holo-accent)]" />
          <span className="text-[var(--holo-text)] font-medium">
            {isOpening ? 'Opening...' : 'Open Folder'}
          </span>
          <ChevronRight
            size={16}
            className="text-[var(--holo-muted)] group-hover:translate-x-1 transition-transform"
          />
        </button>

        {/* Recent folders */}
        {recentFolders.length > 0 && (
          <div className="w-full mt-4">
            <div className="flex items-center gap-2 mb-4 text-[var(--holo-muted)]">
              <Clock size={14} />
              <span className="text-xs uppercase tracking-wider">Recent Folders</span>
            </div>
            <div className="space-y-2">
              {recentFolders.map((folder) => (
                <button
                  key={folder.path}
                  onClick={() => handleOpenRecent(folder.path)}
                  onMouseEnter={() => setHoveredFolder(folder.path)}
                  onMouseLeave={() => setHoveredFolder(null)}
                  disabled={isOpening}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-150 text-left"
                  style={{
                    background:
                      hoveredFolder === folder.path
                        ? 'rgba(100, 150, 255, 0.1)'
                        : 'rgba(20, 20, 30, 0.5)',
                    border: '1px solid',
                    borderColor:
                      hoveredFolder === folder.path
                        ? 'rgba(100, 150, 255, 0.3)'
                        : 'rgba(100, 150, 255, 0.1)',
                  }}
                >
                  <Folder
                    size={18}
                    className={
                      hoveredFolder === folder.path
                        ? 'text-[var(--holo-accent)]'
                        : 'text-[var(--holo-muted)]'
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--holo-text)] font-medium truncate">
                      {folder.name}
                    </div>
                    <div className="text-[var(--holo-muted)] text-xs truncate">
                      {folder.path}
                    </div>
                  </div>
                  <div className="text-[var(--holo-muted)] text-xs whitespace-nowrap">
                    {formatDate(folder.lastOpened)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Keyboard shortcut hint */}
        <div className="mt-8 flex items-center gap-4 text-[var(--holo-muted)] text-xs">
          <span>
            <kbd className="px-2 py-1 rounded bg-[rgba(100,150,255,0.1)] border border-[rgba(100,150,255,0.2)] text-[var(--holo-accent)]">
              ⌘O
            </kbd>
            {' '}Open folder
          </span>
        </div>
      </div>

      {/* Footer branding */}
      <div className="absolute bottom-6 text-center">
        <p
          className="text-xs tracking-widest"
          style={{ fontFamily: 'DepartureMono, monospace', color: 'var(--holo-muted)' }}
        >
          R.A.V.E.N.
        </p>
      </div>

      {/* Keyframe animation */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(30px, -30px); }
          50% { transform: translate(-20px, 20px); }
          75% { transform: translate(40px, 10px); }
        }
      `}</style>
    </div>
  );
}
