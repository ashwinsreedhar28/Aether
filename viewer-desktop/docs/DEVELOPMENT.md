# Viewer Development Guide

Quick reference for developing the Viewer application.

## Getting Started

```bash
# Install dependencies
npm install

# Start in development mode
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Project Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Build all targets (main, preload, renderer) |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |

---

## Adding a New App

1. Create directory: `src/apps/my-app/`

2. Create component: `src/apps/my-app/MyApp.tsx`

```tsx
import { AppProps, useAppContext } from '../AppWrapper'

export function MyApp({ windowId, tabId, filePath, isActive }: AppProps) {
  const { setDirty, fileApi } = useAppContext()

  // Your app logic here

  return <div>My App Content</div>
}
```

3. Create index: `src/apps/my-app/index.ts`

```typescript
import { AppDefinition } from '../types'
import { MyApp } from './MyApp'

export const app: AppDefinition = {
  id: 'my-app',
  name: 'My App',
  icon: 'Box',              // Lucide icon name
  component: MyApp,
  fileTypes: ['myext'],     // Optional: file extensions to handle
  defaultSize: {            // Optional: default window size
    width: 800,
    height: 600
  }
}
```

The app auto-registers via the glob import in `src/apps/index.ts`.

---

## Adding an IPC Handler

1. Create handler file: `electron/main/ipc/myHandlers.ts`

```typescript
import { ipcMain } from 'electron'

export function registerMyHandlers() {
  ipcMain.handle('my:action', async (event, arg1, arg2) => {
    // Handler logic
    return result
  })

  // For events (one-way)
  ipcMain.on('my:event', (event, data) => {
    // Handle event
    event.sender.send('my:response', responseData)
  })
}
```

2. Register in `electron/main/index.ts`:

```typescript
import { registerMyHandlers } from './ipc/myHandlers'
// In createWindow():
registerMyHandlers()
```

3. Add to preload: `electron/preload/index.ts`

```typescript
my: {
  action: (arg1: string, arg2: number): Promise<Result> =>
    ipcRenderer.invoke('my:action', arg1, arg2),
  onResponse: (callback: (data: ResponseData) => void) => {
    const listener = (_: unknown, data: ResponseData) => callback(data)
    ipcRenderer.on('my:response', listener)
    return () => ipcRenderer.removeListener('my:response', listener)
  }
}
```

---

## Working with State

### Reading State

```typescript
import { useWorkspaceStore } from '@/stores/workspaceStore'

// In component
const activeWorkspace = useWorkspaceStore(state => state.activeWorkspace())
const windows = useWorkspaceStore(state => state.getWindows())

// Outside component
const { activeWorkspace, openWindow } = useWorkspaceStore.getState()
```

### Modifying State

```typescript
const { openWindow, closeWindow, addTab } = useWorkspaceStore()

// Open new window
openWindow()

// Add tab to window
addTab(windowId, filePath, appId)

// Close window
closeWindow(windowId)
```

### Creating Selectors

For performance, create specific selectors:

```typescript
// Good - only re-renders when specific data changes
const windowCount = useWorkspaceStore(state =>
  state.activeWorkspace()?.windows.length ?? 0
)

// Avoid - subscribes to entire store
const store = useWorkspaceStore()
```

---

## File System Operations

### From Renderer (React)

```typescript
// Read file
const { content, encoding } = await window.electron.fs.readFile(filePath)

// Write file
await window.electron.fs.writeFile(filePath, content)

// Create file/directory
await window.electron.fs.createFile(parentPath, name, 'file' | 'directory')

// Delete
await window.electron.fs.deleteFile(filePath)

// Rename
await window.electron.fs.rename(oldPath, newPath)

// Watch for changes
const unsubscribe = window.electron.fs.onChange((event) => {
  console.log(event.type, event.path) // 'created' | 'modified' | 'deleted'
})
```

### In App Context

Apps get a simplified API:

```typescript
const { fileApi } = useAppContext()

const content = await fileApi.readFile(filePath)
await fileApi.writeFile(filePath, newContent)
```

---

## Terminal Integration

```typescript
// Create terminal session
const { id, cwd, shell } = await window.electron.terminal.create({
  cwd: '/path/to/dir',
  shell: '/bin/zsh'  // Optional
})

// Write to terminal
window.electron.terminal.write(id, 'ls -la\n')

// Resize terminal
window.electron.terminal.resize(id, cols, rows)

// Listen for output
const unsubscribe = window.electron.terminal.onData((id, data) => {
  // Handle terminal output
})

// Kill session
window.electron.terminal.kill(id)
```

---

## Hooks Reference

### useDrag

```typescript
const { onMouseDown } = useDrag({
  onDrag: (delta) => {
    // Handle drag delta { x, y }
  },
  onDragEnd: () => {
    // Handle drag end
  }
})

<div onMouseDown={onMouseDown}>Draggable</div>
```

### useResize

```typescript
const { getHandleProps } = useResize({
  onResize: (delta, handle) => {
    // Handle resize delta and which handle
  }
})

<div {...getHandleProps('right')}>Right handle</div>
<div {...getHandleProps('bottom-right')}>Corner handle</div>
```

### useSound

```typescript
const playSound = useSound()

playSound('window:open')
playSound('tab:add')
```

---

## Styling Guidelines

### Tailwind Classes

Use Tailwind for all styling:

```tsx
<div className="flex items-center gap-2 p-4 bg-gray-800 rounded-lg">
  <span className="text-sm text-gray-400">Label</span>
</div>
```

### Common Patterns

```tsx
// Card/panel
className="bg-gray-900 border border-gray-700 rounded-lg"

// Interactive element
className="hover:bg-gray-700 active:bg-gray-600 transition-colors"

// Text hierarchy
className="text-white"      // Primary
className="text-gray-300"   // Secondary
className="text-gray-500"   // Muted

// Spacing
className="p-4"             // Standard padding
className="gap-2"           // Standard gap
```

---

## Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

---

## Debugging

### Main Process

Add to `electron/main/index.ts`:

```typescript
mainWindow.webContents.openDevTools()
```

Or use `Cmd+Option+I` in the app.

### Renderer Process

Use browser DevTools (`Cmd+Option+I`) for:
- React DevTools
- Network inspection
- Console logging

### IPC Debugging

Log IPC calls in handlers:

```typescript
ipcMain.handle('my:action', async (event, ...args) => {
  console.log('[IPC] my:action called with:', args)
  // ...
})
```

---

## Common Patterns

### Loading File Content

```tsx
const [content, setContent] = useState<string>('')
const [loading, setLoading] = useState(true)

useEffect(() => {
  if (!filePath) return

  setLoading(true)
  fileApi.readFile(filePath)
    .then(setContent)
    .finally(() => setLoading(false))
}, [filePath])
```

### Marking Tab as Dirty

```tsx
const { setDirty } = useAppContext()

const handleChange = (newContent: string) => {
  setContent(newContent)
  setDirty(true)
}

const handleSave = async () => {
  await fileApi.writeFile(filePath, content)
  setDirty(false)
}
```

### Keyboard Shortcuts

```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }

  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [])
```
