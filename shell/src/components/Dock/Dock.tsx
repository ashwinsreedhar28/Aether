import { useWorkspaceStore } from '../../stores/workspaceStore';
import { DockItem } from './DockItem';

interface DockProps {
  workspaceId: string;
}

export function Dock({ workspaceId }: DockProps) {
  const workspaces = useWorkspaceStore(s => s.workspaces);
  const focusWindow = useWorkspaceStore(s => s.focusWindow);
  const workspace = workspaces.find(w => w.id === workspaceId);
  const windows = workspace?.windows || [];

  // Get minimized windows
  const minimizedWindows = windows.filter(w => w.isMinimized);

  // Don't render dock if no minimized windows
  if (minimizedWindows.length === 0) {
    return null;
  }

  return (
    <div className="fixed left-4 top-20 bottom-4 flex flex-col gap-2 z-40 pointer-events-none">
      <div className="flex flex-col gap-2 pointer-events-auto">
        {minimizedWindows.map(window => (
          <DockItem
            key={window.id}
            window={window}
            onRestore={focusWindow}
          />
        ))}
      </div>
    </div>
  );
}
