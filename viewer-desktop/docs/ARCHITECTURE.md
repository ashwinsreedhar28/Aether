# Viewer Application Architecture

A modern Electron-based desktop application with a multi-workspace, multi-window, tabbed interface for file navigation and application hosting.

## Tech Stack

- **Framework**: Electron 33 + React 19
- **Build**: electron-vite
- **State**: Zustand
- **Styling**: Tailwind CSS
- **Icons**: Lucide React

---

## Project Structure

```
apps/viewer/
├── electron/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # Main entry point, window creation
│   │   ├── menu.ts        # Application menu
│   │   ├── ipc/           # IPC request handlers
│   │   └── services/      # Background services
│   └── preload/
│       └── index.ts       # Context bridge API
├── src/
│   ├── main.tsx           # React entry point
│   ├── App.tsx            # Root component
│   ├── apps/              # Pluggable applications
│   ├── components/        # React components
│   ├── stores/            # Zustand state stores
│   ├── hooks/             # Custom React hooks
│   ├── utils/             # Utility functions
│   ├── audio/             # Sound system
│   └── types/             # TypeScript types
├── electron.vite.config.ts
└── index.html
```

---

## Build Configuration

**electron.vite.config.ts** defines three build targets:

| Target   | Entry                        | Output                   |
|----------|------------------------------|--------------------------|
| main     | `electron/main/index.ts`     | `dist/main/index.cjs`    |
| preload  | `electron/preload/index.ts`  | `dist/preload/index.cjs` |
| renderer | `index.html`                 | `dist/renderer/`         |

---

## Core Concepts

### Workspaces

A workspace represents a single opened folder/root directory:

```typescript
interface Workspace {
  id: string
  rootDir: string
  name: string
  windows: WindowState[]
  expandedDirs: Set<string>
  selectedPath: string | null
  focusedWindowId: string | null
  isTiled: boolean
}
```

### Windows

Each workspace can have multiple floating windows:

```typescript
interface WindowState {
  id: string
  title: string
  tabs: TabState[]
  activeTabId: string | null
  position: { x: number; y: number }
  size: { width: number; height: number }
  isMinimized: boolean
  isMaximized: boolean
  zIndex: number
}
```

### Tabs

Each window can contain multiple tabs:

```typescript
interface TabState {
  id: string
  title: string
  filePath?: string
  appId: string
  isDirty: boolean
  isActive: boolean
  isSuspended: boolean
}
```

---

## State Management

### workspaceStore.ts (Primary Store)

Manages all application state including workspaces, windows, tabs, and recent folders.

**Key Actions**:
- `openWorkspace(rootDir)` - Create or switch to workspace
- `openWindow()` / `closeWindow()` - Window lifecycle
- `addTab()` / `removeTab()` / `switchTab()` - Tab operations
- `tileWindows()` - Auto-arrange windows in grid
- `loadConfig()` / `saveConfig()` - Persistence

### fileSystemStore.ts

Manages file tree state with lazy loading:

**Key Actions**:
- `initRootDir()` - Initialize with root directory
- `loadChildren()` - Lazy load directory contents
- `refreshTree()` - Reload entire tree
- `toggleDir()` - Expand/collapse directories

### appStore.ts

Simple registry for available applications:

- `registerApp()` / `unregisterApp()`
- `getApp(id)` / `getAppForFile(filePath)`

---

## IPC Architecture

### Preload API (`window.electron`)

The preload script exposes a typed API via contextBridge:

```typescript
window.electron = {
  fs: {
    getTree(rootDir): Promise<FileNode>
    getChildren(dirPath): Promise<FileNode[]>
    readFile(filePath): Promise<{ content, encoding }>
    writeFile(filePath, content): Promise<void>
    createFile(parentPath, name, type): Promise<void>
    deleteFile(filePath): Promise<void>
    rename(oldPath, newPath): Promise<void>
    watchDir(dirPath): void
    unwatchDir(dirPath): void
    onChange(callback): () => void
  },
  app: {
    onInitialFolder(callback): () => void
    onWorkspaceOpened(callback): () => void
    closeWorkspace(): void
    focusMainWindow(): void
  },
  config: {
    load(): Promise<SavedConfig>
    save(config): Promise<void>
  },
  terminal: {
    create(options): Promise<{ id, cwd, shell }>
    write(id, data): void
    resize(id, cols, rows): void
    kill(id): void
    onData(callback): () => void
    onExit(callback): () => void
  },
  browser: {
    openExternal(url): void
  },
  raven: { /* Voice assistant API */ },
  agentTask: { /* Task runner API */ }
}
```

### IPC Handlers (Main Process)

Located in `electron/main/ipc/`:

| Handler | File | Purpose |
|---------|------|---------|
| File operations | `fileHandlers.ts` | Read/write/watch files |
| Config | `configHandlers.ts` | Load/save user config |
| Terminal | `terminalHandlers.ts` | PTY session management |
| Browser | `browserHandlers.ts` | Open external URLs |
| Agent Task | `agentTaskHandlers.ts` | Task automation proxy |
| Raven | `ravenHandlers.ts` | Voice assistant control |

---

## Component Architecture

### Core Layout

```
App.tsx
└── Desktop.tsx
    ├── WorkspaceTabs.tsx      # Multi-workspace tabs
    ├── FileExplorer.tsx       # File tree sidebar
    ├── Window.tsx (multiple)  # Floating windows
    │   ├── TabBar.tsx         # Window tabs
    │   └── AppWrapper.tsx     # App container
    │       └── [App Component]
    ├── Dock.tsx               # Bottom taskbar
    └── SearchModal.tsx        # Quick file search
```

### Window Component

Handles:
- Drag-to-move via `useDrag` hook
- Resize from edges/corners via `useResize` hook
- Tab suspension for performance
- Minimize/maximize/restore
- Focus management

### FileExplorer Component

Features:
- Lazy-loading file tree
- Breadcrumb navigation
- Context menus (create/delete/rename)
- Multi-selection support
- File change subscriptions

---

## App System

### App Definition

Apps are self-contained modules in `src/apps/*/index.ts`:

```typescript
interface AppDefinition {
  id: string
  name: string
  icon: string              // Lucide icon name
  component: ComponentType<AppProps>
  fileTypes?: string[]      // File extensions to handle
  defaultSize?: { width: number; height: number }
}

interface AppProps {
  windowId: string
  tabId: string
  filePath?: string
  isActive: boolean
}
```

### Available Apps

| App | ID | File Types |
|-----|----|------------|
| Text Editor | `text-editor` | Fallback for all text |
| Markdown Editor | `markdown-editor` | `.md` |
| JSON Viewer | `json-viewer` | `.json` |
| PDF Viewer | `pdf-viewer` | `.pdf` |
| Image Viewer | `image-viewer` | `.png`, `.jpg`, `.gif`, `.webp` |
| HTML Preview | `html-preview` | `.html` |
| LaTeX Viewer | `latex-viewer` | `.tex` |
| Terminal | `terminal` | (none - standalone) |
| Browser | `browser` | (none - standalone) |
| Kanban Board | `kanban-board` | `.kanban`, `kb_*.json` |
| Knowledge Graph | `knowledge-graph` | (none - standalone) |
| Calculator | `calculator` | (none - standalone) |
| Sound Designer | `sound-designer` | (none - standalone) |
| Agent Manager | `agent-manager` | `.agents` |
| API Manager | `api-manager` | `.api` |
| Raven | `raven` | (none - standalone) |

### App Context

Apps receive context via `useAppContext()`:

```typescript
const {
  windowId,
  tabId,
  isActive,
  openFile,        // Open file in new tab
  openWindow,      // Open new window
  closeTab,        // Close current tab
  setDirty,        // Mark tab as having unsaved changes
  updateTab,       // Update tab metadata
  setSuspended,    // Control suspension state
  fileApi          // { readFile, writeFile }
} = useAppContext()
```

### App Registration

Apps auto-register via glob import in `src/apps/index.ts`:

```typescript
const appModules = import.meta.glob('./*/index.ts', { eager: true })
```

---

## Services

### FileWatcherService

`electron/main/services/fileWatcher.ts`

- Uses `@parcel/watcher` for efficient file watching
- Depth limited to 3 to avoid EMFILE errors
- Emits `fs:onChange` events to renderer
- Supports per-directory subscription

### RavenDaemonManager

`electron/main/services/ravenDaemonManager.ts`

- Manages Raven voice assistant daemon process
- WebSocket connection for streaming updates
- Start/stop/status control

---

## Audio System

`src/audio/`

Provides synthesized sound feedback for UI actions:

**Events**:
- `window:open`, `window:close`, `window:focus`, `window:minimize`, `window:maximize`
- `tab:add`, `tab:remove`, `tab:switch`, `tab:reorder`, `tab:tearOff`
- `folder:expand`, `folder:collapse`
- `workspace:switch`, `workspace:tile`

**Components**:
- `soundEngine.ts` - Main controller
- `synthesis.ts` - Web Audio API synthesis
- `defaultBindings.ts` - Event-to-sound mappings

---

## Utilities

| File | Purpose |
|------|---------|
| `tileLayoutCalculator.ts` | Calculate grid layout for window tiling |
| `snapCalculator.ts` | Snap windows to edges/neighbors |
| `languageDetection.ts` | Detect language for syntax highlighting |
| `performanceConfig.ts` | Tab suspension timing config |

---

## Keyboard Shortcuts

### Global (from Menu)

| Shortcut | Action |
|----------|--------|
| `Cmd+O` | Open folder |
| `Cmd+Shift+O` | Add folder to workspace |
| `Cmd+Shift+W` | Close workspace |
| `Cmd+T` | New terminal |
| `Cmd+Arrow` | Focus adjacent window |

### Window Navigation

Arrow key navigation focuses adjacent windows based on position.

---

## Configuration & Persistence

**Location**: `~/Library/Application Support/viewer/`

**Saved State**:
- Workspace list (rootDir, name, windows)
- Window positions, sizes, z-indices
- Expanded directories
- Tab states
- Recent folders (last 10)

Config is loaded on app start and debounced-saved on state changes.

---

## Data Flow Example: Opening a File

```
1. User double-clicks file in FileExplorer
2. FileExplorer calls workspaceStore.addTab(windowId, filePath, appId)
3. WorkspaceStore creates TabState, updates window
4. Desktop re-renders, calls getAppForFile(filePath)
5. App Registry returns app definition (e.g., TextEditor)
6. Window renders TabBar and active tab content
7. AppWrapper provides AppContext
8. App calls fileApi.readFile(filePath) via IPC
9. Main process reads file from filesystem
10. App displays content
```

---

## Performance Considerations

See [PERFORMANCE_CHECKLIST.md](./PERFORMANCE_CHECKLIST.md) for detailed guidelines.

**Key optimizations**:
- Lazy loading of file tree (maxDepth=5)
- Tab suspension for inactive heavy components
- Debounced config persistence
- Depth-limited file watching
- Prefetching grandchildren for smooth UX

---

## Leap Input Subsystem (Renderer-Only)

Leap Motion support is optional and runs entirely in the renderer process.

- Viewer behavior is unchanged when Leap service is unavailable.
- A single global layer mounts in `src/App.tsx` and remains workspace-agnostic.
- V1 injects input only into core Viewer + React app surfaces; embedded `webview` remains unsupported for synthetic input.

### Runtime Modules

Located in `src/leap/`:

- `types.ts` - normalized frame/hand/cursor and interaction types
- `LeapWebSocketClient.ts` - WebSocket connection, endpoint fallback (`v7` -> `v6`), reconnect loop
- `cursorMapping.ts` - 3D hand mapping to viewport cursor coordinates with smoothing
- `gestureEngine.ts` - pinch hysteresis and interaction mode selection (`pressCandidate`, `drag`, `scroll`)
- `eventInjector.ts` - pointer/mouse/wheel event synthesis and dispatch

### UI Layer

Located in `src/components/Leap/`:

- `LeapControllerLayer.tsx` - frame processing loop, interaction lock, safety cleanup on blur/visibility changes
- `LeapOverlay.tsx` - dual holographic crosshair rendering and connection indicator

### Interaction Policy (V1)

- Two tracked hands render two crosshairs.
- First hand to pinch acquires interaction lock until release.
- Pinch on draggable targets enters drag mode immediately.
- Non-draggable pinch starts as press candidate and can transition to scroll after movement threshold.
- Forced release occurs on hand loss, blur, hidden tab, or Leap disable to prevent stuck pressed input.
