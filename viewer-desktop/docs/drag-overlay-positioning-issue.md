# Drag Overlay Positioning Issue

## Problem Description

When dragging tabs in the TabBar component, the DragOverlay element that follows the cursor is not consistently positioned relative to the mouse cursor. The offset varies based on window size and where the user clicks on the tab.

### Observed Behavior

- Sometimes the overlay appears directly under the cursor
- Sometimes it appears far to the right
- The offset changes when the window is resized
- The offset is inconsistent across different drag operations

### Expected Behavior

The drag overlay should appear with the cursor positioned at the exact point where the user clicked on the tab, creating a "stuck to cursor" effect that remains consistent regardless of:

- Window size
- Window position
- Where on the tab the user clicks
- Screen resolution

## Technical Context

### Technology Stack

- **@dnd-kit/core** v6.3.1 - Drag and drop framework
- **@dnd-kit/sortable** v10.0.0 - Sortable functionality
- **React** with TypeScript

### Current Implementation

**File**: `src/components/Window/TabBar.tsx`

The current approach uses:

1. `DragOverlay` component from @dnd-kit/core
2. Custom offset tracking via `MouseEvent.offsetX` and `offsetY`
3. CSS transform to position the overlay relative to cursor

```typescript
const handleDragStart = (event: DragStartEvent) => {
  const { active } = event;
  const tab = window.tabs?.find((t) => t.id === active.id);
  if (tab) {
    setActiveTab(tab);

    // Use offsetX/offsetY which gives position relative to the element
    const activatorEvent = event.activatorEvent as MouseEvent;
    if (activatorEvent) {
      setDragOffset({
        x: activatorEvent.offsetX,
        y: activatorEvent.offsetY,
      });
    }
  }
};
```

```tsx
<DragOverlay
  dropAnimation={{
    duration: 200,
    easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
  }}
>
  {activeTab ? (
    <div
      style={{
        transform: dragOffset
          ? `translate(-${dragOffset.x}px, -${dragOffset.y}px)`
          : undefined,
      }}
    >
      {/* Overlay content */}
    </div>
  ) : null}
</DragOverlay>
```

## Attempts to Fix

### Attempt 1: Using Element Rect

- **Approach**: Calculate offset using `active.rect.current.translated`
- **Result**: Failed - positioning was inconsistent
- **Why it failed**: The `translated` rect includes transforms that may not be in the correct coordinate space

```typescript
// FAILED APPROACH
const elementRect = active.rect.current.translated;
setDragOffset({
  x: activatorEvent.clientX - elementRect.left,
  y: activatorEvent.clientY - elementRect.top,
});
```

### Attempt 2: Using offsetX/offsetY

- **Approach**: Use `MouseEvent.offsetX` and `offsetY` directly
- **Result**: Still inconsistent
- **Current status**: This is the current implementation

```typescript
// CURRENT APPROACH (STILL FAILING)
setDragOffset({
  x: activatorEvent.offsetX,
  y: activatorEvent.offsetY,
});
```

## Root Cause Analysis

### Hypothesis 1: DragOverlay Portal Positioning

The `DragOverlay` component uses a React portal and positions itself based on the drag coordinates. The issue may be:

- The portal's positioning context differs from the tab element's context
- Transforms or positioning from parent elements are not accounted for
- The overlay's coordinate system doesn't match the event's coordinate system

### Hypothesis 2: Event Target Mismatch

The `offsetX/offsetY` values may be relative to the wrong element:

- If event bubbling occurs, `offsetX/offsetY` may be relative to a child element
- The drag handle spans (icon, text, close button) may be the actual target
- Need to ensure we're getting offset relative to the tab container

### Hypothesis 3: Transform Stacking

Multiple transforms may be interfering:

- The `useSortable` hook applies transforms to the original tab
- The `DragOverlay` has its own positioning
- Our custom transform may be adding to or conflicting with existing transforms

## Potential Solutions

### Solution 1: Use @dnd-kit Modifiers

Use built-in modifiers from `@dnd-kit/modifiers` package:

```bash
npm install @dnd-kit/modifiers
```

```typescript
import { snapCenterToCursor } from '@dnd-kit/modifiers';

<DndContext
  modifiers={[snapCenterToCursor]}
  // ...
>
```

**Pros**: Built-in solution, well-tested
**Cons**: May need to center the drag preview instead of maintaining click offset

### Solution 2: Custom Drag Preview with Fixed Point

Create a smaller, simpler drag preview that's centered:

```typescript
<DragOverlay>
  {activeTab ? (
    <div className="drag-preview-simple">{activeTab.title}</div>
  ) : null}
</DragOverlay>
```

**Pros**: Simpler, more predictable
**Cons**: Loses visual continuity with the original tab

### Solution 3: Disable DragOverlay Transform

Remove the custom transform and rely on DragOverlay's default behavior:

```typescript
<DragOverlay adjustScale={false} wrapperElement="div">
  {/* Don't apply custom transform */}
</DragOverlay>
```

**Pros**: May work if DragOverlay handles positioning correctly by default
**Cons**: Might not give the desired "grab point" behavior

### Solution 4: Track Mouse Movement Manually

Instead of using DragOverlay's positioning, manually position the overlay:

```typescript
const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

useEffect(() => {
  const handleMouseMove = (e: MouseEvent) => {
    setMousePosition({ x: e.clientX, y: e.clientY });
  };

  if (isDragging) {
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }
}, [isDragging]);

// Render with fixed position
<div
  style={{
    position: "fixed",
    left: mousePosition.x - dragOffset.x,
    top: mousePosition.y - dragOffset.y,
    pointerEvents: "none",
  }}
>
  {/* Overlay content */}
</div>;
```

**Pros**: Full control over positioning
**Cons**: Bypasses @dnd-kit's optimization, may have performance issues

### Solution 5: Debug Event Targets

Ensure we're getting the offset from the correct element:

```typescript
const handleDragStart = (event: DragStartEvent) => {
  const activatorEvent = event.activatorEvent as MouseEvent;

  // Find the actual tab element (not a child)
  const tabElement = (activatorEvent.target as HTMLElement).closest(
    "[data-tab-id]"
  );

  if (tabElement) {
    const rect = tabElement.getBoundingClientRect();
    setDragOffset({
      x: activatorEvent.clientX - rect.left,
      y: activatorEvent.clientY - rect.top,
    });
  }
};
```

**Pros**: Ensures consistent reference point
**Cons**: Requires adding data attributes to elements

## Debugging Instructions

### Quick Debug Version

Replace the `handleDragStart` function in `TabBar.tsx` with this version to see detailed logging:

```typescript
const handleDragStart = (event: DragStartEvent) => {
  const { active } = event;
  const tab = window.tabs?.find((t) => t.id === active.id);

  if (tab) {
    setActiveTab(tab);

    const activatorEvent = event.activatorEvent as MouseEvent;

    if (activatorEvent) {
      // Debug logging
      console.group("🎯 Drag Start Debug");
      console.log("Tab ID:", tab.id);
      console.log("Tab Title:", tab.title);
      console.log("");

      console.log("📍 Mouse Event Coordinates:");
      console.log(
        "  clientX/Y:",
        activatorEvent.clientX,
        activatorEvent.clientY
      );
      console.log(
        "  offsetX/Y:",
        activatorEvent.offsetX,
        activatorEvent.offsetY
      );
      console.log("  pageX/Y:", activatorEvent.pageX, activatorEvent.pageY);
      console.log(
        "  screenX/Y:",
        activatorEvent.screenX,
        activatorEvent.screenY
      );
      console.log("");

      console.log("🎯 Event Target:");
      console.log("  Target element:", activatorEvent.target);
      console.log(
        "  Target tagName:",
        (activatorEvent.target as HTMLElement).tagName
      );
      console.log(
        "  Target className:",
        (activatorEvent.target as HTMLElement).className
      );
      console.log("");

      console.log("📦 Element Rects:");
      if (active.rect.current.initial) {
        console.log("  Initial rect:", {
          top: active.rect.current.initial.top,
          left: active.rect.current.initial.left,
          width: active.rect.current.initial.width,
          height: active.rect.current.initial.height,
        });
      }
      if (active.rect.current.translated) {
        console.log("  Translated rect:", {
          top: active.rect.current.translated.top,
          left: active.rect.current.translated.left,
          width: active.rect.current.translated.width,
          height: active.rect.current.translated.height,
        });
      }
      console.log("");

      console.log("🪟 Window Info:");
      console.log("  Inner size:", window.innerWidth, "x", window.innerHeight);
      console.log("  Scroll position:", window.scrollX, window.scrollY);
      console.log("");

      // Calculate offset
      const offset = {
        x: activatorEvent.offsetX,
        y: activatorEvent.offsetY,
      };

      console.log("📏 Calculated Offset:");
      console.log("  offset.x:", offset.x);
      console.log("  offset.y:", offset.y);
      console.log("");

      console.log("🎨 Expected Transform:");
      console.log(`  translate(-${offset.x}px, -${offset.y}px)`);
      console.groupEnd();

      setDragOffset(offset);
    }
  }
};
```

### Test Scenarios

Run these tests and record the console output:

#### Test 1: Click Center of Tab

1. Open multiple tabs
2. Click and drag from the center of a tab
3. Copy the console output
4. Note the visual offset

#### Test 2: Click Left Edge of Tab

1. Click and drag from the left edge (near the icon)
2. Copy the console output
3. Note the visual offset

#### Test 3: Click Right Edge of Tab

1. Click and drag from the right edge (near close button)
2. Copy the console output
3. Note the visual offset

#### Test 4: Different Window Sizes

1. Resize window to small (800x600)
2. Drag a tab, copy console output
3. Resize window to large (1920x1080)
4. Drag a tab, copy console output
5. Compare the offset calculations

#### Test 5: Check Event Target

Pay special attention to the "Event Target" section:

- Is it the tab container div?
- Is it a child element (icon, span, button)?
- Does the target change based on where you click?

### What to Look For

#### Clue 1: Consistent offsetX/Y

If `offsetX/offsetY` values are wildly different between drags, the problem is likely:

- Event target is not consistent (clicking on different child elements)
- Need to use `closest()` to find the tab container

#### Clue 2: Rect Position Issues

If `initial` and `translated` rects have very different positions:

- The sortable transforms are affecting measurements
- May need to use initial rect instead

#### Clue 3: Window Size Correlation

If offset error increases with window size:

- Coordinate system mismatch
- May be using page coordinates instead of client coordinates

#### Clue 4: Target Element Varies

If the target element changes (sometimes div, sometimes span):

- Need to normalize to always get offset from the tab container
- Use `getBoundingClientRect()` on the tab container element

### Alternative: Test with Static Position

Try this simplified version that ignores offset and centers the overlay:

```typescript
// In DragOverlay, remove the transform:
<div
  className="flex items-center gap-1.5 px-3 py-1.5 min-w-[120px] max-w-[200px]
             bg-[var(--holo-accent)]/30 text-[var(--holo-text)]
             border-2 border-[var(--holo-accent)] rounded shadow-2xl"
  // NO TRANSFORM HERE
>
  <span className="text-xs font-medium truncate">{activeTab.title}</span>
</div>
```

If this works better (overlay follows cursor but at wrong offset), the issue is with the transform calculation.

If this still doesn't work (overlay appears in wrong place entirely), the issue is with DragOverlay positioning.

### Recording Findings

Create a file `docs/drag-debug-results.md` with:

1. Console output from each test
2. Screenshots showing the visual offset
3. Window size during each test
4. Any patterns you notice

This will help identify the root cause.

## Related Issues

- [dnd-kit issue #334](https://github.com/clauderic/dnd-kit/issues/334) - DragOverlay positioning
- [dnd-kit issue #569](https://github.com/clauderic/dnd-kit/issues/569) - Custom drag preview positioning

## Next Steps

1. Add debug logging to collect positioning data
2. Test with different window sizes and record offset values
3. Try Solution 1 (modifiers) as it's the most straightforward
4. If modifiers don't work, try Solution 4 (manual positioning)
5. Consider creating a minimal reproduction to report to @dnd-kit if issue persists

## Files Modified

- `src/components/Window/TabBar.tsx` - Main drag and drop implementation
- `src/components/Window/Tab.tsx` - Individual tab with useSortable hook
- `src/stores/windowStore.ts` - Tab reordering logic

## Date Created

2025-01-26

## Status

🔴 **Unresolved** - Issue persists after multiple attempts
