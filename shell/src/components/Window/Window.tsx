import { useCallback, useEffect, useRef, memo } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useDrag } from '../../hooks/useDrag';
import { useResize } from '../../hooks/useResize';
import { calculateSnap } from '../../utils/snapCalculator';
import { AUTO_SUSPEND_AFTER_INACTIVE_MS } from '../../utils/performanceConfig';
import { TabBar } from './TabBar';
import { FileViewer } from '../common/FileViewer';
import { soundEngine } from '../../audio';
import type { WindowState } from '../../types';

interface WindowProps {
  window: WindowState;
  isFocused: boolean;
  children?: React.ReactNode;  // Make optional since we'll use tabs
}

export const Window = memo(function Window({ window, isFocused, children }: WindowProps) {
  const moveWindow = useWorkspaceStore(s => s.moveWindow);
  const resizeWindow = useWorkspaceStore(s => s.resizeWindow);
  const focusWindow = useWorkspaceStore(s => s.focusWindow);
  const closeWindow = useWorkspaceStore(s => s.closeWindow);
  const minimizeWindow = useWorkspaceStore(s => s.minimizeWindow);
  const maximizeWindow = useWorkspaceStore(s => s.maximizeWindow);
  const restoreWindow = useWorkspaceStore(s => s.restoreWindow);
  const getActiveWorkspace = useWorkspaceStore(s => s.getActiveWorkspace);

  // Get animation state from active workspace
  const activeWorkspace = getActiveWorkspace();
  const isAnimatingTile = activeWorkspace?.isAnimatingTile || false;

  const windowRef = useRef<HTMLDivElement>(null);

  // Track position for resize
  const currentPosition = useRef(window.position);
  const currentSize = useRef(window.size);

  // Update refs when props change
  useEffect(() => {
    currentPosition.current = window.position;
    currentSize.current = window.size;
  }, [window.position, window.size]);

  // Auto-suspend heavy tabs after they are inactive for a while
  const suspendTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    if (!window.tabs) return;

    const timers = suspendTimersRef.current;
    const tabIds = new Set(window.tabs.map(t => t.id));

    // Clean up timers for removed tabs
    for (const [tabId, timer] of timers.entries()) {
      if (!tabIds.has(tabId)) {
        clearTimeout(timer);
        timers.delete(tabId);
      }
    }

    for (const tab of window.tabs) {
      const delayMs = AUTO_SUSPEND_AFTER_INACTIVE_MS[tab.appId];

      // Cancel pending timers when tab becomes active or shouldn't be suspended
      if (tab.isActive || tab.isDirty || tab.isSuspended || !delayMs) {
        const timer = timers.get(tab.id);
        if (timer) {
          clearTimeout(timer);
          timers.delete(tab.id);
        }
        continue;
      }

      // Schedule suspension if not already scheduled
      if (!timers.has(tab.id)) {
        const timer = setTimeout(() => {
          const { getActiveWorkspace, setTabSuspended } = useWorkspaceStore.getState();
          const activeWorkspace = getActiveWorkspace();
          const win = activeWorkspace?.windows.find(w => w.id === window.id);
          const latest = win?.tabs?.find(t => t.id === tab.id);

          if (!latest || latest.isActive || latest.isDirty || latest.isSuspended) return;
          setTabSuspended(window.id, tab.id, true);
        }, delayMs);

        timers.set(tab.id, timer);
      }
    }

  }, [window.id, window.tabs]);

  useEffect(() => {
    const timers = suspendTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // Drag handling
  const { handleMouseDown: handleDragStart, isDragging } = useDrag({
    onDrag: useCallback(
      (delta) => {
        // Don't snap when maximized
        if (window.isMaximized) return;

        // Calculate new position based on delta
        const proposedPos = {
          x: currentPosition.current.x + delta.x,
          y: currentPosition.current.y + delta.y,
        };

        // Get container dimensions
        const containerSize = {
          width: globalThis.window.innerWidth,
          height: globalThis.window.innerHeight,
        };

        // Create temporary window state for snap calculation
        const tempWindow = {
          ...window,
          position: proposedPos,
        };

        // Get fresh windows list for snapping without subscribing to updates
        const activeWorkspace = useWorkspaceStore.getState().getActiveWorkspace();
        const otherWindows = (activeWorkspace?.windows || []).filter(w => w.id !== window.id);

        // Calculate snapped position
        const snapResult = calculateSnap(
          tempWindow,
          otherWindows,
          containerSize,
          10 // snap distance in pixels
        );

        // Use snapped position
        const newPos = {
          x: snapResult.x,
          y: snapResult.y,
        };

        currentPosition.current = newPos;
        moveWindow(window.id, newPos);
      },
      [window, moveWindow]
    ),
    onDragStart: useCallback(() => {
      soundEngine.playEvent('drag:start');
    }, []),
    onDragEnd: useCallback(() => {
      soundEngine.playEvent('drag:end');
    }, []),
  });

  // Resize handling
  const { handleResizeStart, isResizing } = useResize({
    onResize: useCallback(
      (delta) => {
        const newSize = {
          width: Math.max(200, currentSize.current.width + delta.width),
          height: Math.max(150, currentSize.current.height + delta.height),
        };
        const newPos = {
          x: currentPosition.current.x + delta.x,
          y: currentPosition.current.y + delta.y,
        };

        currentSize.current = newSize;
        currentPosition.current = newPos;

        resizeWindow(window.id, newSize);
        if (delta.x !== 0 || delta.y !== 0) {
          moveWindow(window.id, newPos);
        }
      },
      [window.id, resizeWindow, moveWindow]
    ),
    onResizeStart: useCallback(() => {
      soundEngine.playEvent('window:resize');
    }, []),
  });

  const handleFocus = useCallback(() => {
    focusWindow(window.id);
  }, [window.id, focusWindow]);

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      closeWindow(window.id);
    },
    [window.id, closeWindow]
  );

  const handleMinimize = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      minimizeWindow(window.id);
    },
    [window.id, minimizeWindow]
  );

  const handleMaximize = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (window.isMaximized) {
        restoreWindow(window.id);
      } else {
        maximizeWindow(window.id);
      }
    },
    [window.id, window.isMaximized, maximizeWindow, restoreWindow]
  );

  if (window.isMinimized) {
    return null;
  }

  // Buffer around fullscreen windows so the outer glow is visible
  const FULLSCREEN_BUFFER = 12;

  const style = window.isMaximized
    ? {
      left: FULLSCREEN_BUFFER,
      top: FULLSCREEN_BUFFER,
      width: `calc(100% - ${FULLSCREEN_BUFFER * 2}px)`,
      height: `calc(100% - ${FULLSCREEN_BUFFER * 2}px)`,
      zIndex: window.zIndex,
    }
    : {
      left: window.position.x,
      top: window.position.y,
      width: window.size.width,
      height: window.size.height,
      zIndex: window.zIndex,
    };

  return (
    <div
      ref={windowRef}
      className={`absolute holo-panel window-enter overflow-hidden flex flex-col group ${isFocused ? 'window-focused' : ''
        } ${isDragging ? 'dragging' : ''} ${isResizing ? 'resizing' : ''} ${isAnimatingTile ? 'window-tiling' : ''}`}
      style={style}
      onMouseDown={handleFocus}
    >
      {/* Minimal title bar - controls appear on hover */}
      <div
        className="window-title-bar flex items-center justify-between px-3 py-2 border-b border-[var(--holo-border)] bg-gradient-to-r from-[rgba(255,255,255,0.03)] to-transparent"
        onMouseDown={handleDragStart}
      >
        <span className="text-xs font-medium truncate text-[var(--holo-muted)] group-hover:text-[var(--holo-text)] transition-colors">
          {window.title}
        </span>

        {/* Window controls - hidden until hover */}
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150" onMouseDown={(e) => e.stopPropagation()}>
          <button
            onClick={handleMinimize}
            className="w-2.5 h-2.5 rounded-full bg-[var(--holo-border)] hover:bg-cyan-400 hover:shadow-[0_0_8px_rgba(0,255,255,0.6)] transition-all duration-150"
            title="Minimize"
          />
          <button
            onClick={handleMaximize}
            className="w-2.5 h-2.5 rounded-full bg-[var(--holo-border)] hover:bg-violet-400 hover:shadow-[0_0_8px_rgba(167,139,250,0.6)] transition-all duration-150"
            title={window.isMaximized ? 'Restore' : 'Maximize'}
          />
          <button
            onClick={handleClose}
            className="w-2.5 h-2.5 rounded-full bg-[var(--holo-border)] hover:bg-rose-400 hover:shadow-[0_0_8px_rgba(251,113,133,0.6)] transition-all duration-150"
            title="Close"
          />
        </div>
      </div>

      {/* Tab Bar */}
      <TabBar window={window} />

      {/* Content */}
      <div className="flex-1 overflow-auto relative">
        {(() => {
          // If we have tabs, render ALL tabs but hide inactive ones
          if (window.tabs && window.tabs.length > 0) {
            return window.tabs.map(tab => {
              const isVisible = tab.id === window.activeTabId;

              // If a tab is suspended and not visible, don't mount anything for it.
              if (!isVisible && tab.isSuspended) {
                return null;
              }

              return (
              <div
                key={tab.id}
                className="absolute inset-0"
                style={{ display: isVisible ? 'block' : 'none' }}
              >
                {tab.isSuspended ? (
                  <SuspendedTab
                    title={tab.title}
                    onResume={() => useWorkspaceStore.getState().setTabSuspended(window.id, tab.id, false)}
                  />
                ) : (
                  <FileViewer
                    windowId={window.id}
                    tabId={tab.id}
                    filePath={tab.filePath}
                    appId={tab.appId}
                    isActive={isFocused && tab.id === window.activeTabId}
                  />
                )}
              </div>
              );
            });
          }

          // Fallback to legacy children if no tabs (backwards compatibility)
          return children;
        })()}
      </div>

      {/* Resize handles (only when not maximized) */}
      {!window.isMaximized && (
        <>
          <div className="resize-handle resize-handle-n" onMouseDown={handleResizeStart('n')} />
          <div className="resize-handle resize-handle-s" onMouseDown={handleResizeStart('s')} />
          <div className="resize-handle resize-handle-e" onMouseDown={handleResizeStart('e')} />
          <div className="resize-handle resize-handle-w" onMouseDown={handleResizeStart('w')} />
          <div className="resize-handle resize-handle-ne" onMouseDown={handleResizeStart('ne')} />
          <div className="resize-handle resize-handle-nw" onMouseDown={handleResizeStart('nw')} />
          <div className="resize-handle resize-handle-se" onMouseDown={handleResizeStart('se')} />
          <div className="resize-handle resize-handle-sw" onMouseDown={handleResizeStart('sw')} />
        </>
      )}
    </div>
  );
});

function SuspendedTab({ title, onResume }: { title: string; onResume: () => void }) {
  return (
    <div className="h-full w-full flex items-center justify-center bg-[rgba(10,10,20,0.6)]">
      <div className="holo-panel p-4 max-w-md w-[92%]">
        <div className="text-sm text-[var(--holo-text)] truncate">{title}</div>
        <div className="text-xs text-[var(--holo-muted)] mt-1">
          This tab is suspended to save resources.
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={onResume}
            className="px-3 py-1.5 text-sm bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] rounded hover:bg-[var(--holo-accent)]/30 transition-colors"
          >
            Resume
          </button>
        </div>
      </div>
    </div>
  );
}
