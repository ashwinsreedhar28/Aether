# Viewer Performance Checklist

Use this as a punch-list. Check the items you want me to implement.

## Browser (biggest slowdown suspects)

- [x] Unmount inactive tabs for heavy apps (especially Browser)
  - Plain English: Right now, tabs stay “alive” even when hidden; the Browser tab can keep running in the background.
  - Performance impact: Often large (CPU/GPU + memory), especially if multiple Browser tabs/windows exist.
  - Where: `src/components/Window/Window.tsx` (currently hides inactive tabs with `display: none`).
  - Notes: Please only do this for the browser for now, but make it so that we can configure this feature for any app.

- [x] Add “Suspend/Discard tab” for Browser webviews
  - Plain English: Add a button/menu action to stop the page and free resources (optionally show a “Click to reload” placeholder).
  - Performance impact: Medium to large (reduces background CPU + memory churn on heavy sites).
  - Notes: Can be manual (user-triggered) and/or automatic when inactive for N minutes. Please make it so it goes inactive after 2 miniutes if inactive

- [x] Guard Browser global keyboard listeners with `isActive`
  - Plain English: Only register hotkeys (like Cmd+L) when the Browser tab is actually focused, so hidden tabs don’t keep listening.
  - Performance impact: Small to medium (prevents event-listener buildup and extra work as Browser instances grow).
  - Where: `src/apps/browser/components/AddressBar.tsx` (currently always registers `window.addEventListener('keydown', ...)`).

- [ ] Add “Clear browser data/cache” and optional “Incognito” partition
  - Plain English: Persistent browser storage grows over time; clearing it (or using a non-persistent profile) can keep startup/navigation snappy.
  - Performance impact: Medium (improves long-term stability; reduces slowdowns after lots of browsing).
  - Where: Browser webview uses `partition="persist:browser"` in `src/apps/browser/components/WebViewContainer.tsx`.

- [x] Reduce Browser state update frequency (throttle noisy events)
  - Plain English: If the webview fires lots of events, React state updates can cause UI churn; throttling reduces rerenders.
  - Performance impact: Small to medium (UI smoothness; avoids frequent React work).
  - Where: `src/apps/browser/components/WebViewContainer.tsx` → calls `onStateChange(...)` on navigation/loading events.

## App loading / bundle size (startup + overall memory)

- [x] Lazy-load apps instead of eager-loading all app modules at startup
  - Plain English: Don’t load code for every app up front (PDF/Monaco/Three/etc.); only load an app when you open it.
  - Performance impact: Large (faster startup, less memory, less “first interaction” jank).
  - Where: `src/apps/index.ts` currently uses `import.meta.glob(..., { eager: true })`.

- [ ] Add per-app code-splitting for heavyweight dependencies
  - Plain English: Ensure big libraries (Monaco, pdf.js, three.js) live in their app chunks, not in the main UI bundle.
  - Performance impact: Medium to large (faster cold start; less memory at idle).
  - Notes: Often naturally solved by the lazy-load change above, but sometimes needs small refactors to avoid shared imports.

## React + Zustand rerender reductions (UI smoothness)

- [x] Replace `useWorkspaceStore()` “whole store” subscriptions with selectors in hot components
  - Plain English: Subscribing to the entire store forces rerenders whenever *anything* changes; selectors rerender only when needed.
  - Performance impact: Medium to large (less jank when moving windows, typing, switching tabs, opening browser).
  - Where: Examples include `src/App.tsx`, `src/components/Desktop/Desktop.tsx`, `src/components/Window/TabBar.tsx`.

- [x] Remove debug logging and expensive dev-only work in drag/tab code
  - Plain English: Console logging inside frequent handlers slows things down, especially during drag operations.
  - Performance impact: Small to medium (noticeable during dragging).
  - Where: `src/components/Window/TabBar.tsx` uses `console.group/log` during drag end.

- [x] Avoid work on every render that scales with number of windows/tabs
  - Plain English: Some logic recomputes “focused window” or scans every window frequently; memoize or compute once per change.
  - Performance impact: Small to medium (helps as window count grows).
  - Where: `src/components/Desktop/Desktop.tsx` recalculates focused/adjacent windows and scans open tabs.

## Visual effects (GPU/render cost)

- [ ] Add a “Performance Mode” toggle that reduces blur/glow/shadows
  - Plain English: Blur and layered shadows are expensive in Electron; a toggle can make everything feel snappier.
  - Performance impact: Medium (especially on lower-end GPUs or when many windows are visible).
  - Where: `.holo-panel` uses `backdrop-filter: blur(12px)` in `src/index.css`.

- [ ] Disable/limit animations during heavy interactions (drag/resize)
  - Plain English: While dragging/resizing, avoid transitions/shadows that force extra repainting.
  - Performance impact: Small to medium (makes drag/resize feel more responsive).
  - Notes: You already track `isDragging` / `isResizing` in `Window.tsx`; we can use that to reduce effects.

## File system / background work (less contention)

- [ ] Reduce file tree refresh/work on workspace switch (incremental updates)
  - Plain English: Avoid rebuilding/refreshing the full tree more than necessary; prefer incremental updates or refresh only what’s visible.
  - Performance impact: Small to medium (depends on repo size).
  - Where: `src/components/Desktop/Desktop.tsx` calls `refreshTree()` on workspace change.

## Observability (so we fix the right thing first)

- [ ] Add lightweight perf instrumentation around window/tab rendering
  - Plain English: Add simple timing logs (dev-only) to confirm what’s slow (rerenders vs webview vs effects).
  - Performance impact: Indirect but high ROI (prevents guessing; speeds up iteration).
  - Notes: Kept behind `import.meta.env.DEV` so it doesn’t affect production.

