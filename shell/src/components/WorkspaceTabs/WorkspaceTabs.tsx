import { useState } from 'react';
import { Folder, X, Plus } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore';

export function WorkspaceTabs() {
  const { workspaces, activeWorkspaceId, switchWorkspace, closeWorkspace, openWorkspace } = useWorkspaceStore();
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);

  const handleAddWorkspace = async () => {
    const result = await window.electron.app.openFolderDialog(true);
    if (result) {
      await openWorkspace(result.path);
    }
  };

  const handleCloseWorkspace = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    closeWorkspace(id);
  };

  return (
    <div
      className="flex items-center h-10 px-2 gap-1 shrink-0"
      style={{
        background: 'rgba(10, 10, 15, 0.9)',
        borderBottom: '1px solid rgba(100, 150, 255, 0.15)',
      }}
    >
      {workspaces.map((workspace) => {
        const isActive = workspace.id === activeWorkspaceId;
        const isHovered = hoveredTab === workspace.id;

        return (
          <button
            key={workspace.id}
            onClick={() => switchWorkspace(workspace.id)}
            onMouseEnter={() => setHoveredTab(workspace.id)}
            onMouseLeave={() => {
              setHoveredTab(null);
              setHoveredClose(null);
            }}
            className="group flex items-center gap-2 px-3 py-1.5 rounded-t-md transition-all duration-150 max-w-[200px]"
            style={{
              background: isActive
                ? 'rgba(20, 20, 30, 0.9)'
                : isHovered
                  ? 'rgba(100, 150, 255, 0.1)'
                  : 'transparent',
              borderLeft: '1px solid',
              borderRight: '1px solid',
              borderTop: '1px solid',
              borderColor: isActive
                ? 'rgba(100, 150, 255, 0.3)'
                : 'transparent',
              marginBottom: isActive ? '-1px' : '0',
              paddingBottom: isActive ? 'calc(0.375rem + 1px)' : '0.375rem',
            }}
          >
            <Folder
              size={14}
              className={isActive ? 'text-[var(--holo-accent)]' : 'text-[var(--holo-muted)]'}
            />
            <span
              className="truncate text-sm"
              style={{
                color: isActive ? 'var(--holo-text)' : 'var(--holo-muted)',
              }}
            >
              {workspace.name}
            </span>
            {workspaces.length > 1 && (
              <button
                onClick={(e) => handleCloseWorkspace(e, workspace.id)}
                onMouseEnter={() => setHoveredClose(workspace.id)}
                onMouseLeave={() => setHoveredClose(null)}
                className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                style={{
                  background:
                    hoveredClose === workspace.id
                      ? 'rgba(255, 100, 100, 0.2)'
                      : 'transparent',
                }}
              >
                <X
                  size={12}
                  className={
                    hoveredClose === workspace.id
                      ? 'text-red-400'
                      : 'text-[var(--holo-muted)]'
                  }
                />
              </button>
            )}
          </button>
        );
      })}

      {/* Add workspace button */}
      <button
        onClick={handleAddWorkspace}
        className="flex items-center justify-center w-7 h-7 rounded transition-all duration-150"
        style={{
          background: 'transparent',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(100, 150, 255, 0.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
        title="Add folder to workspace"
      >
        <Plus size={16} className="text-[var(--holo-muted)]" />
      </button>
    </div>
  );
}
