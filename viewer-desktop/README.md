# Viewer

A modern Electron-based desktop application with a multi-workspace, multi-window, tabbed interface for file navigation and application hosting.

## Quick Start

```bash
# Install dependencies
npm install

# Start development
npm run dev

# Build for production
npm run build
```

## Tech Stack

- **Electron 33** - Desktop framework
- **React 19** - UI framework
- **electron-vite** - Build tooling
- **Zustand** - State management
- **Tailwind CSS** - Styling
- **node-pty** - Terminal emulation

## Features

- **Multi-Workspace**: Open multiple folders as separate workspaces
- **Tabbed Windows**: Each window supports multiple tabs
- **Drag & Drop**: Windows can be dragged, resized, and tiled
- **File Tree**: Lazy-loading file explorer with live updates
- **Terminal**: Integrated terminal with full PTY support
- **Pluggable Apps**: Extensible app system for different file types

### Built-in Apps

| App | File Types |
|-----|------------|
| Text Editor | Fallback for all text files |
| Markdown Editor | `.md` |
| JSON Viewer | `.json` |
| PDF Viewer | `.pdf` |
| Image Viewer | `.png`, `.jpg`, `.gif`, `.webp` |
| HTML Preview | `.html` |
| Terminal | Standalone |
| Kanban Board | `.kanban` |
| Knowledge Graph | Standalone |
| And more... | |

## Project Structure

```
viewer/
├── electron/
│   ├── main/           # Electron main process
│   │   ├── index.ts    # App entry, window creation
│   │   ├── ipc/        # IPC handlers
│   │   └── services/   # Background services
│   └── preload/        # Context bridge API
├── src/
│   ├── App.tsx         # Root component
│   ├── apps/           # Pluggable applications
│   ├── components/     # React components
│   ├── stores/         # Zustand stores
│   ├── hooks/          # Custom hooks
│   └── utils/          # Utilities
└── docs/               # Documentation
```

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) - System design and concepts
- [Development Guide](./docs/DEVELOPMENT.md) - How to develop and extend
- [API Reference](./docs/API_REFERENCE.md) - IPC and store APIs
- [Performance Checklist](./docs/PERFORMANCE_CHECKLIST.md) - Performance guidelines

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+O` | Open folder |
| `Cmd+Shift+O` | Add folder to workspace |
| `Cmd+Shift+W` | Close workspace |
| `Cmd+T` | New terminal |
| `Cmd+Arrow` | Navigate between windows |

## Configuration

User configuration is stored in:
- macOS: `~/Library/Application Support/viewer/`
- Linux: `~/.config/viewer/`
- Windows: `%APPDATA%/viewer/`
