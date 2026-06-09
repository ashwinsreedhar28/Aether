# Viewer API Reference

## Electron IPC API

All IPC methods are available via `window.electron` in the renderer process.

---

### File System (`window.electron.fs`)

#### `getTree(rootDir: string): Promise<FileNode>`

Get the initial file tree for a directory.

```typescript
const tree = await window.electron.fs.getTree('/path/to/project')
```

#### `getChildren(dirPath: string): Promise<FileNode[]>`

Lazy-load children of a directory.

```typescript
const children = await window.electron.fs.getChildren('/path/to/dir')
```

#### `readFile(filePath: string): Promise<FileReadResponse>`

Read file contents.

```typescript
interface FileReadResponse {
  content: string
  encoding: 'utf8' | 'base64'
}

const { content, encoding } = await window.electron.fs.readFile('/path/to/file.txt')
```

#### `writeFile(filePath: string, content: string): Promise<void>`

Write content to file.

```typescript
await window.electron.fs.writeFile('/path/to/file.txt', 'Hello, World!')
```

#### `createFile(parentPath: string, name: string, type: 'file' | 'directory'): Promise<void>`

Create a new file or directory.

```typescript
await window.electron.fs.createFile('/path/to/parent', 'newfile.txt', 'file')
await window.electron.fs.createFile('/path/to/parent', 'newfolder', 'directory')
```

#### `deleteFile(filePath: string): Promise<void>`

Delete a file or directory.

```typescript
await window.electron.fs.deleteFile('/path/to/file.txt')
```

#### `rename(oldPath: string, newPath: string): Promise<void>`

Rename or move a file.

```typescript
await window.electron.fs.rename('/old/path.txt', '/new/path.txt')
```

#### `watchDir(dirPath: string): void`

Subscribe to changes in a directory.

```typescript
window.electron.fs.watchDir('/path/to/dir')
```

#### `unwatchDir(dirPath: string): void`

Unsubscribe from directory changes.

```typescript
window.electron.fs.unwatchDir('/path/to/dir')
```

#### `onChange(callback): () => void`

Listen for file change events. Returns unsubscribe function.

```typescript
interface FileChangeEvent {
  type: 'created' | 'modified' | 'deleted'
  path: string
  rootDir: string
}

const unsubscribe = window.electron.fs.onChange((event) => {
  console.log(event.type, event.path)
})

// Later: unsubscribe()
```

---

### Application (`window.electron.app`)

#### `onInitialFolder(callback: (folder: string) => void): () => void`

Listen for initial folder from CLI arguments.

```typescript
const unsubscribe = window.electron.app.onInitialFolder((folder) => {
  console.log('Opening folder:', folder)
})
```

#### `onWorkspaceOpened(callback: (folder: string) => void): () => void`

Listen for workspace opened from menu.

```typescript
const unsubscribe = window.electron.app.onWorkspaceOpened((folder) => {
  console.log('Workspace opened:', folder)
})
```

#### `closeWorkspace(): void`

Close the current workspace.

```typescript
window.electron.app.closeWorkspace()
```

#### `focusMainWindow(): void`

Focus the main application window.

```typescript
window.electron.app.focusMainWindow()
```

---

### Configuration (`window.electron.config`)

#### `load(): Promise<SavedConfig | null>`

Load saved configuration.

```typescript
interface SavedConfig {
  workspaces: Array<{
    id: string
    rootDir: string
    name: string
    windows: WindowState[]
    // ...
  }>
  recentFolders: Array<{
    path: string
    name: string
    lastOpened: number
  }>
}

const config = await window.electron.config.load()
```

#### `save(config: SavedConfig): Promise<void>`

Save configuration.

```typescript
await window.electron.config.save(config)
```

---

### Terminal (`window.electron.terminal`)

#### `create(options?): Promise<TerminalCreateResponse>`

Create a new terminal session.

```typescript
interface TerminalCreateOptions {
  cwd?: string
  shell?: string
}

interface TerminalCreateResponse {
  id: string
  cwd: string
  shell: string
}

const { id, cwd, shell } = await window.electron.terminal.create({
  cwd: '/path/to/dir'
})
```

#### `write(id: string, data: string): void`

Send input to terminal.

```typescript
window.electron.terminal.write(terminalId, 'ls -la\n')
```

#### `resize(id: string, cols: number, rows: number): void`

Resize terminal dimensions.

```typescript
window.electron.terminal.resize(terminalId, 80, 24)
```

#### `kill(id: string): void`

Kill terminal session.

```typescript
window.electron.terminal.kill(terminalId)
```

#### `getShells(): Promise<string[]>`

Get available shells.

```typescript
const shells = await window.electron.terminal.getShells()
// ['/bin/zsh', '/bin/bash', '/bin/sh']
```

#### `onData(callback: (id: string, data: string) => void): () => void`

Listen for terminal output.

```typescript
const unsubscribe = window.electron.terminal.onData((id, data) => {
  console.log(`Terminal ${id}:`, data)
})
```

#### `onExit(callback: (id: string, code: number) => void): () => void`

Listen for terminal exit.

```typescript
const unsubscribe = window.electron.terminal.onExit((id, code) => {
  console.log(`Terminal ${id} exited with code ${code}`)
})
```

---

### Browser (`window.electron.browser`)

#### `openExternal(url: string): void`

Open URL in default browser.

```typescript
window.electron.browser.openExternal('https://example.com')
```

---

## Zustand Stores

### WorkspaceStore

Main application state store.

```typescript
import { useWorkspaceStore } from '@/stores/workspaceStore'
```

#### State

```typescript
interface WorkspaceStore {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  recentFolders: RecentFolder[]
  configLoaded: boolean
}
```

#### Selectors

| Selector | Description |
|----------|-------------|
| `activeWorkspace()` | Get the currently active workspace |
| `getWindows()` | Get all windows in active workspace |
| `getWindow(id)` | Get specific window by ID |
| `focusedWindow()` | Get the focused window |

#### Workspace Actions

| Action | Description |
|--------|-------------|
| `openWorkspace(rootDir)` | Open folder as workspace |
| `closeWorkspace(id?)` | Close workspace |
| `switchWorkspace(id)` | Switch to workspace |
| `reorderWorkspaces(oldIndex, newIndex)` | Reorder workspace tabs |

#### Window Actions

| Action | Description |
|--------|-------------|
| `openWindow()` | Create new window |
| `closeWindow(id)` | Close window |
| `focusWindow(id)` | Focus window (bring to front) |
| `moveWindow(id, position)` | Move window position |
| `resizeWindow(id, size)` | Resize window |
| `minimizeWindow(id)` | Minimize window |
| `maximizeWindow(id)` | Maximize window |
| `restoreWindow(id)` | Restore minimized/maximized |
| `tileWindows(focusedId?)` | Auto-arrange in grid |

#### Tab Actions

| Action | Description |
|--------|-------------|
| `addTab(windowId, filePath?, appId)` | Add tab to window |
| `removeTab(windowId, tabId)` | Remove tab |
| `switchTab(windowId, tabId)` | Activate tab |
| `moveTab(fromWindow, toWindow, tabId)` | Move tab between windows |
| `reorderTab(windowId, oldIdx, newIdx)` | Reorder tabs |
| `tearOffTab(windowId, tabId, position)` | Create window from tab |
| `updateTabDirty(windowId, tabId, dirty)` | Mark tab dirty |
| `updateTab(windowId, tabId, updates)` | Update tab properties |
| `setTabSuspended(windowId, tabId, suspended)` | Suspend/resume tab |

#### File System Actions

| Action | Description |
|--------|-------------|
| `toggleDir(path)` | Toggle directory expanded state |
| `expandDir(path)` | Expand directory |
| `collapseDir(path)` | Collapse directory |
| `setSelectedPath(path)` | Set selected file path |

#### Config Actions

| Action | Description |
|--------|-------------|
| `loadConfig()` | Load config from disk |
| `saveConfig()` | Save config to disk (debounced) |
| `addRecentFolder(path, name)` | Add to recent folders |

---

### FileSystemStore

File tree state with lazy loading.

```typescript
import { useFileSystemStore } from '@/stores/fileSystemStore'
```

#### State

```typescript
interface FileSystemStore {
  tree: FileNode | null
  selectedPaths: Set<string>
  expandedDirs: Set<string>
  loadedDirs: Set<string>
  loadingDirs: Set<string>
  rootDir: string | null
  loading: boolean
  error: string | null
}
```

#### Actions

| Action | Description |
|--------|-------------|
| `initRootDir(dir)` | Initialize with root directory |
| `refreshTree()` | Reload entire tree |
| `loadChildren(path)` | Load directory children |
| `toggleDir(path)` | Toggle expand/collapse |
| `expandDir(path)` | Expand directory |
| `collapseDir(path)` | Collapse directory |
| `selectPath(path)` | Select single path |
| `selectPaths(paths)` | Select multiple paths |
| `toggleSelection(path)` | Toggle path selection |
| `clearSelection()` | Clear all selections |

---

### AppStore

Application registry.

```typescript
import { useAppStore } from '@/stores/appStore'
```

#### Actions

| Action | Description |
|--------|-------------|
| `registerApp(app)` | Register an app |
| `unregisterApp(id)` | Unregister an app |
| `getApp(id)` | Get app by ID |
| `getAppForFile(path)` | Get app for file type |

---

## Types

### Core Types

```typescript
interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  extension?: string
  modified?: number
  size?: number
}

interface TabState {
  id: string
  title: string
  filePath?: string
  appId: string
  isDirty: boolean
  isActive: boolean
  isSuspended: boolean
}

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

interface Workspace {
  id: string
  rootDir: string
  name: string
  windows: WindowState[]
  expandedDirs: Set<string>
  selectedPath: string | null
  focusedWindowId: string | null
  isTiled: boolean
  nextZIndex: number
  terminalCounter: number
  preTileState?: Map<string, { position; size }>
}
```

### App Types

```typescript
interface AppDefinition {
  id: string
  name: string
  icon: string
  component: ComponentType<AppProps>
  fileTypes?: string[]
  defaultSize?: { width: number; height: number }
}

interface AppProps {
  windowId: string
  tabId: string
  filePath?: string
  isActive: boolean
}

interface AppContextValue {
  windowId: string
  tabId: string
  isActive: boolean
  openFile: (filePath: string, appId?: string) => void
  openWindow: (appId: string) => void
  closeTab: () => void
  setDirty: (dirty: boolean) => void
  updateTab: (updates: Partial<TabState>) => void
  setSuspended: (suspended: boolean) => void
  fileApi: {
    readFile: (path: string) => Promise<string>
    writeFile: (path: string, content: string) => Promise<void>
  }
}
```

---

## App Settings Schema

Viewer persists app settings in `config.appSettings`.

```typescript
interface LeapInputSettings {
  enabled: boolean
  endpoint: string
  smoothing: number
  pinchThreshold: number
  releaseThreshold: number
  dragActivationPx: number
  scrollActivationPx: number
  scrollSensitivity: number
  showCrosshairs: boolean
  reconnectMs: number
}

interface InputSettings {
  leap: LeapInputSettings
}

interface ThemeSettings {
  colorScheme: 'dark' | 'light'
  accentColor: 'blue' | 'purple' | 'green' | 'orange' | 'pink' | 'cyan'
  windowOpacity: number
  fontSize: 'small' | 'medium' | 'large'
}

interface AppSettings {
  defaultProjectsFolder: string | null
  theme: ThemeSettings
  input: InputSettings
}
```

---

## Leap Runtime Status Store

`src/stores/leapStore.ts`

```typescript
interface LeapRuntimeState {
  connectionStatus: 'disabled' | 'connecting' | 'connected' | 'error'
  error: string | null
  endpoint: string
  trackedHands: number
  lastFrameAt: number | null
}
```

This store is runtime-only and used by the global Leap controller and Settings -> Input panel.
