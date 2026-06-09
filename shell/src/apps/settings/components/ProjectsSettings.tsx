import { useState, useEffect } from 'react';
import { FolderOpen, X } from 'lucide-react';
import { useSettingsStore } from '../../../stores/settingsStore';

export function ProjectsSettings() {
  const settings = useSettingsStore((s) => s.settings);
  const setDefaultProjectsFolder = useSettingsStore((s) => s.setDefaultProjectsFolder);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSettings().finally(() => setIsLoading(false));
  }, [loadSettings]);

  const handleChooseFolder = async () => {
    try {
      const result = await window.electron.app.openFolderDialog();
      if (result?.path) {
        setDefaultProjectsFolder(result.path);
      }
    } catch (err) {
      console.error('Failed to open folder dialog:', err);
    }
  };

  const handleClearFolder = () => {
    setDefaultProjectsFolder(null);
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-[var(--holo-muted)]">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="h-full p-6 overflow-auto">
      <div className="max-w-lg space-y-6">
        {/* Section Header */}
        <div>
          <h2 className="text-sm font-medium text-[var(--holo-text)] mb-1">
            Default Projects Folder
          </h2>
          <p className="text-xs text-[var(--holo-muted)]">
            When creating a new project (Cmd+Shift+N), it will be created in this folder.
            If not set, you'll be prompted to choose a location each time.
          </p>
        </div>

        {/* Current folder display */}
        <div className="space-y-3">
          {settings.defaultProjectsFolder ? (
            <div className="flex items-center gap-2 p-3 bg-[var(--holo-border)]/30 rounded-lg border border-[var(--holo-border)]">
              <FolderOpen size={16} className="text-[var(--holo-accent)] flex-shrink-0" />
              <span className="flex-1 text-sm text-[var(--holo-text)] truncate font-mono">
                {settings.defaultProjectsFolder}
              </span>
              <button
                onClick={handleClearFolder}
                className="p-1 text-[var(--holo-muted)] hover:text-red-400 transition-colors"
                title="Clear folder"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 bg-[var(--holo-border)]/10 rounded-lg border border-dashed border-[var(--holo-border)]">
              <FolderOpen size={16} className="text-[var(--holo-muted)]" />
              <span className="text-sm text-[var(--holo-muted)] italic">
                No default folder set
              </span>
            </div>
          )}

          <button
            onClick={handleChooseFolder}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-[var(--holo-accent)]/10 text-[var(--holo-accent)] border border-[var(--holo-accent)]/30 rounded-lg hover:bg-[var(--holo-accent)]/20 transition-colors"
          >
            <FolderOpen size={14} />
            {settings.defaultProjectsFolder ? 'Change Folder' : 'Choose Folder'}
          </button>
        </div>

        {/* Info box */}
        <div className="p-4 bg-[var(--holo-accent)]/5 border border-[var(--holo-accent)]/20 rounded-lg">
          <h3 className="text-xs font-medium text-[var(--holo-accent)] mb-2 uppercase tracking-wider">
            Keyboard Shortcut
          </h3>
          <p className="text-xs text-[var(--holo-muted)]">
            Press <kbd className="px-1.5 py-0.5 bg-[var(--holo-border)] rounded text-[var(--holo-text)] font-mono">Cmd+Shift+N</kbd> to
            create a new project. A dialog will appear asking for the project name.
          </p>
        </div>
      </div>
    </div>
  );
}
