import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type {
  DragEndEvent,
  DragStartEvent,
  DragMoveEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Tab } from "./Tab";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { WindowState, TabState } from "../../types";

interface TabBarProps {
  window: WindowState;
}

export function TabBar({ window }: TabBarProps) {
  const switchTab = useWorkspaceStore(s => s.switchTab);
  const removeTab = useWorkspaceStore(s => s.removeTab);
  const reorderTab = useWorkspaceStore(s => s.reorderTab);
  const tearOffTab = useWorkspaceStore(s => s.tearOffTab);
  const moveTab = useWorkspaceStore(s => s.moveTab);

  // Use ref for logic state to avoid stale closures in event handlers
  const dragInfoRef = useRef<{
    tab: TabState;
    initialX: number;
    initialY: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Visual state for rendering the portal
  const [dragState, setDragState] = useState<{
    tab: TabState;
    currentX: number;
    currentY: number;
  } | null>(null);

  const handleSwitchTab = (tabId: string) => {
    switchTab(window.id, tabId);
  };

  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeTab(window.id, tabId);
  };

  // Drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before dragging starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const tab = window.tabs?.find((t) => t.id === active.id);
    if (tab) {
      const activatorEvent = event.activatorEvent as MouseEvent;
      // Find the tab element using data attribute for robust targeting
      const target = activatorEvent.target as HTMLElement;
      const tabNode = target.closest(`[data-tab-id="${tab.id}"]`);

      if (tabNode) {
        const rect = tabNode.getBoundingClientRect();

        dragInfoRef.current = {
          tab,
          initialX: rect.left,
          initialY: rect.top,
        };

        setDragState({
          tab,
          currentX: rect.left,
          currentY: rect.top,
        });
      }
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    if (dragInfoRef.current) {
      setDragState({
        tab: dragInfoRef.current.tab,
        currentX: dragInfoRef.current.initialX + event.delta.x,
        currentY: dragInfoRef.current.initialY + event.delta.y,
      });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const dragInfo = dragInfoRef.current;

    // Clear state
    dragInfoRef.current = null;
    setDragState(null);

    if (!window.tabs || !dragInfo) {
      return;
    }

    // Calculate final coordinates using initial position + delta
    const finalX = dragInfo.initialX + event.delta.x;
    const finalY = dragInfo.initialY + event.delta.y;

    // Check if we are strictly inside the current tab bar container
    let isInsideContainer = false;
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      // Add a small buffer (e.g. 30px) to allow "sloppy" reordering but detect clear pull-away
      const buffer = 30;
      const pointerX = finalX + 20; // Approximate pointer X relative to item
      const pointerY = finalY + 15; // Approximate pointer Y relative to item

      isInsideContainer =
        pointerX >= rect.left - buffer &&
        pointerX <= rect.right + buffer &&
        pointerY >= rect.top - buffer &&
        pointerY <= rect.bottom + buffer;
    }

    // Case 1: Reorder within same window (MUST be inside container and valid over)
    if (isInsideContainer && over && active.id !== over.id) {
      const oldIndex = window.tabs.findIndex((t) => t.id === active.id);
      const newIndex = window.tabs.findIndex((t) => t.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        reorderTab(window.id, oldIndex, newIndex);
      }
      return;
    }

    // Case 2: Dragged outside (tear-off or move to another window)
    // If we are NOT inside the container, we treat it as a move/tear-off even if 'over' is set
    if (!isInsideContainer) {
      const finalX = dragInfo.initialX + event.delta.x;
      const finalY = dragInfo.initialY + event.delta.y;

      // Check if dropped over another window
      // We use the pointer coordinates or an approximation based on the dragged element position
      // Using center of the element for better hit testing
      const hitX = finalX + 40;
      const hitY = finalY + 20;

      const hitElements = document.elementsFromPoint(hitX, hitY);

      const targetTabBar = hitElements.find(
        (el) => el.getAttribute("data-droppable-id") === "tab-bar"
      );

      if (targetTabBar) {
        const targetWindowId = targetTabBar.getAttribute("data-window-id");

        // If dropped on a different window
        if (targetWindowId && targetWindowId !== window.id) {
          moveTab(window.id, targetWindowId, dragInfo.tab.id);
          return;
        }
      }

      // Case 3: Tear off into new window
      if (window.tabs.length > 1) {
        tearOffTab(window.id, dragInfo.tab.id, {
          x: finalX,
          y: finalY,
        });
      }
    }
  };

  // Don't render if no tabs
  if (!window.tabs || window.tabs.length === 0) {
    return null;
  }

  // Only show tab bar if there's more than one tab
  if (window.tabs.length === 1) {
    return null;
  }

  const tabIds = window.tabs.map((tab) => tab.id);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
        <div
          ref={containerRef}
          className="flex items-center border-b border-[var(--holo-border)] bg-[rgba(10,10,15,0.8)] overflow-x-auto scrollbar-thin"
          data-droppable-id="tab-bar"
          data-window-id={window.id}
        >
          {window.tabs.map((tab) => (
            <Tab
              key={tab.id}
              tab={tab}
              isActive={tab.id === window.activeTabId}
              onSwitch={() => handleSwitchTab(tab.id)}
              onClose={(e) => handleCloseTab(tab.id, e)}
            />
          ))}
        </div>
      </SortableContext>

      {dragState &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: dragState.currentX,
              top: dragState.currentY,
              zIndex: 9999,
              pointerEvents: "none",
            }}
          >
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 min-w-[120px] max-w-[200px]
                       bg-[var(--holo-accent)]/30 text-[var(--holo-text)]
                       border-r border-[var(--holo-border)]
                       border-2 border-[var(--holo-accent)] rounded shadow-2xl
                       backdrop-blur-sm cursor-grabbing"
            >
              <span className="text-xs font-medium truncate">
                {dragState.tab.title}
              </span>
            </div>
          </div>,
          document.body
        )}
    </DndContext>
  );
}
