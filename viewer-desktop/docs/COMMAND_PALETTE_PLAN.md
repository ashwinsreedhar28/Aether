# Claude Command Palette Feature Plan

**Feature**: Cmd+/ Command Palette with Claude Agent SDK Integration
**Author**: RAVEN
**Date**: 2026-02-15

---

## Overview

Add a quick-access command palette (Cmd+/) that allows natural language queries and commands to Claude, with full access to the file system and Claude Code tools. Similar to ChatGPT's Option+Space desktop shortcut, but integrated directly into Viewer with workspace context.

### Key Requirements

1. **Keyboard Shortcut**: Cmd+/ opens/closes the palette
2. **Claude Agent SDK**: Use `@anthropic-ai/claude-agent-sdk` for AI capabilities
3. **OAuth Authentication**: Use Anthropic subscription (like Claude Code) - no API keys
4. **File System Access**: Claude Code tools (Read, Write, Edit, Glob, Grep, Bash, etc.)
5. **Workspace Context**: Aware of current open file and workspace root

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Renderer Process                         │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    CommandPalette.tsx                        │ │
│  │  - Fixed overlay at bottom of screen                        │ │
│  │  - Text input + streaming response display                  │ │
│  │  - Keyboard navigation (Escape to close)                    │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              │ IPC                                │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │             window.electron.claude.*                         │ │
│  │  - query(prompt, context)                                   │ │
│  │  - abort()                                                   │ │
│  │  - getAuthStatus()                                          │ │
│  │  - authenticate()                                           │ │
│  │  - onStream(callback)                                       │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ IPC Bridge
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Main Process                             │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              electron/main/ipc/claudeHandlers.ts             │ │
│  │  - ipcMain.handle('claude:query', ...)                      │ │
│  │  - ipcMain.handle('claude:abort', ...)                      │ │
│  │  - ipcMain.handle('claude:auth', ...)                       │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              electron/main/services/claudeService.ts         │ │
│  │  - Uses @anthropic-ai/claude-agent-sdk                      │ │
│  │  - Manages query lifecycle                                  │ │
│  │  - Streams responses back via IPC                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Core Infrastructure

#### 1.1 Install Claude Agent SDK

```bash
cd apps/viewer
npm install @anthropic-ai/claude-agent-sdk
```

#### 1.2 Create Claude Service (`electron/main/services/claudeService.ts`)

```typescript
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export interface ClaudeQueryOptions {
  prompt: string;
  cwd: string;                    // Workspace root
  currentFile?: string;           // Active file path for context
  onMessage: (msg: SDKMessage) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

export class ClaudeService {
  private activeQuery: ReturnType<typeof query> | null = null;
  private abortController: AbortController | null = null;

  async query(options: ClaudeQueryOptions): Promise<void> {
    this.abortController = new AbortController();

    // Build context-aware system prompt
    const systemPrompt = this.buildSystemPrompt(options);

    this.activeQuery = query({
      prompt: options.prompt,
      options: {
        cwd: options.cwd,
        abortController: this.abortController,

        // Use Claude Code's default tools
        tools: { type: 'preset', preset: 'claude_code' },

        // Use Claude Code's system prompt with custom append
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: systemPrompt
        },

        // Stream partial messages for real-time display
        includePartialMessages: true,

        // Auto-accept edits for quick operations (user can override)
        permissionMode: 'acceptEdits',

        // Load project settings for CLAUDE.md if present
        settingSources: ['project'],

        // Limit turns for quick commands
        maxTurns: 10,
      }
    });

    try {
      for await (const message of this.activeQuery) {
        options.onMessage(message);
      }
      options.onComplete();
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        options.onError(error);
      }
    }
  }

  abort(): void {
    this.abortController?.abort();
    this.activeQuery = null;
  }

  private buildSystemPrompt(options: ClaudeQueryOptions): string {
    let context = `\n\nYou are a quick-command assistant in the Viewer desktop app.`;
    context += `\nWorkspace: ${options.cwd}`;

    if (options.currentFile) {
      context += `\nCurrently open file: ${options.currentFile}`;
    }

    context += `\n\nBe concise. This is a command palette for quick tasks.`;
    return context;
  }

  async getAuthStatus(): Promise<{ authenticated: boolean; email?: string }> {
    // Check for CLAUDE_CODE_OAUTH_TOKEN in environment
    // or validate existing token
    const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (token) {
      // Optionally validate by making a quick accountInfo() call
      return { authenticated: true };
    }
    return { authenticated: false };
  }

  async authenticate(): Promise<void> {
    // Open browser to Anthropic OAuth flow
    // This mimics `claude setup-token` behavior
    // Store token in keychain or secure storage
  }
}

export const claudeService = new ClaudeService();
```

#### 1.3 Create IPC Handlers (`electron/main/ipc/claudeHandlers.ts`)

```typescript
import { ipcMain, BrowserWindow } from 'electron';
import { claudeService } from '../services/claudeService';

export function registerClaudeHandlers(mainWindow: BrowserWindow): void {

  ipcMain.handle('claude:query', async (_, prompt: string, context: {
    cwd: string;
    currentFile?: string
  }) => {
    return new Promise((resolve, reject) => {
      claudeService.query({
        prompt,
        cwd: context.cwd,
        currentFile: context.currentFile,
        onMessage: (msg) => {
          mainWindow.webContents.send('claude:stream', msg);
        },
        onComplete: () => {
          resolve({ success: true });
        },
        onError: (error) => {
          reject(error);
        }
      });
    });
  });

  ipcMain.handle('claude:abort', async () => {
    claudeService.abort();
    return { success: true };
  });

  ipcMain.handle('claude:auth-status', async () => {
    return claudeService.getAuthStatus();
  });

  ipcMain.handle('claude:authenticate', async () => {
    await claudeService.authenticate();
    return { success: true };
  });
}
```

#### 1.4 Update Preload Script (`electron/preload/index.ts`)

Add to the existing contextBridge.exposeInMainWorld:

```typescript
claude: {
  query: (prompt: string, context: { cwd: string; currentFile?: string }): Promise<void> =>
    ipcRenderer.invoke('claude:query', prompt, context),
  abort: (): Promise<void> =>
    ipcRenderer.invoke('claude:abort'),
  getAuthStatus: (): Promise<{ authenticated: boolean; email?: string }> =>
    ipcRenderer.invoke('claude:auth-status'),
  authenticate: (): Promise<void> =>
    ipcRenderer.invoke('claude:authenticate'),
  onStream: (callback: (message: unknown) => void): (() => void) => {
    const handler = (_: unknown, message: unknown) => callback(message);
    ipcRenderer.on('claude:stream', handler);
    return () => ipcRenderer.removeListener('claude:stream', handler);
  }
}
```

#### 1.5 Add TypeScript Declarations (`src/types/electron.d.ts`)

```typescript
interface ClaudeAPI {
  query: (prompt: string, context: { cwd: string; currentFile?: string }) => Promise<void>;
  abort: () => Promise<void>;
  getAuthStatus: () => Promise<{ authenticated: boolean; email?: string }>;
  authenticate: () => Promise<void>;
  onStream: (callback: (message: SDKMessage) => void) => () => void;
}

interface ElectronAPI {
  // ... existing
  claude: ClaudeAPI;
}
```

---

### Phase 2: Menu & Keyboard Shortcut

#### 2.1 Add Menu Item (`electron/main/menu.ts`)

```typescript
{
  label: 'AI',
  submenu: [
    {
      label: 'Command Palette',
      accelerator: 'CmdOrCtrl+/',
      click: () => {
        mainWindow.webContents.send('menu:open-command-palette');
      }
    },
    { type: 'separator' },
    {
      label: 'Authenticate with Anthropic',
      click: () => {
        mainWindow.webContents.send('menu:claude-auth');
      }
    }
  ]
}
```

#### 2.2 Intercept in Main Process (`electron/main/index.ts`)

Add to existing `before-input-event` handler:

```typescript
if (input.meta && input.key === '/' && input.type === 'keyDown') {
  event.preventDefault();
  mainWindow.webContents.send('menu:open-command-palette');
  return;
}
```

---

### Phase 3: UI Component

#### 3.1 Create CommandPalette Component (`src/components/CommandPalette/CommandPalette.tsx`)

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, X, Loader2, AlertCircle } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useFileSystemStore } from '../../stores/fileSystemStore';
import { soundEngine } from '../../audio';

interface StreamedContent {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  content: string;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [responses, setResponses] = useState<StreamedContent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);

  const { rootDir } = useFileSystemStore();
  const activeWorkspace = useWorkspaceStore(s => s.workspaces[s.activeWorkspaceId]);

  // Get current file from active window/tab
  const getCurrentFile = useCallback(() => {
    if (!activeWorkspace) return undefined;
    const activeWindow = activeWorkspace.windows.find(w =>
      w.id === activeWorkspace.focusedWindowId
    );
    if (!activeWindow) return undefined;
    const activeTab = activeWindow.tabs.find(t => t.id === activeWindow.activeTabId);
    return activeTab?.filePath;
  }, [activeWorkspace]);

  // Check auth status on mount
  useEffect(() => {
    window.electron.claude.getAuthStatus().then(status => {
      setIsAuthenticated(status.authenticated);
    });
  }, []);

  // Set up stream listener
  useEffect(() => {
    const cleanup = window.electron.claude.onStream((message: any) => {
      // Parse SDK message and extract displayable content
      if (message.type === 'assistant') {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          content.forEach((block: any) => {
            if (block.type === 'text') {
              setResponses(prev => [...prev, { type: 'text', content: block.text }]);
            } else if (block.type === 'tool_use') {
              setResponses(prev => [...prev, {
                type: 'tool_use',
                content: `Using ${block.name}...`
              }]);
            }
          });
        }
      } else if (message.type === 'stream_event') {
        // Handle partial streaming for real-time text display
        const delta = message.event?.delta;
        if (delta?.type === 'text_delta') {
          setResponses(prev => {
            const last = prev[prev.length - 1];
            if (last?.type === 'text') {
              return [...prev.slice(0, -1), {
                type: 'text',
                content: last.content + delta.text
              }];
            }
            return [...prev, { type: 'text', content: delta.text }];
          });
        }
      } else if (message.type === 'result') {
        setIsProcessing(false);
        if (message.is_error) {
          setError(message.errors?.join(', ') || 'An error occurred');
        }
      }
    });

    return cleanup;
  }, []);

  // Auto-scroll responses
  useEffect(() => {
    responseRef.current?.scrollTo(0, responseRef.current.scrollHeight);
  }, [responses]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle submit
  const handleSubmit = async () => {
    if (!input.trim() || isProcessing) return;

    setIsProcessing(true);
    setResponses([]);
    setError(null);
    soundEngine.playEvent('notification:info');

    try {
      await window.electron.claude.query(input, {
        cwd: rootDir || process.cwd(),
        currentFile: getCurrentFile()
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
      setIsProcessing(false);
    }
  };

  // Handle keyboard
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (isProcessing) {
        window.electron.claude.abort();
        setIsProcessing(false);
      } else {
        onClose();
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Handle authentication
  const handleAuth = async () => {
    await window.electron.claude.authenticate();
    const status = await window.electron.claude.getAuthStatus();
    setIsAuthenticated(status.authenticated);
  };

  // Render auth prompt if not authenticated
  if (isAuthenticated === false) {
    return (
      <div
        className="fixed inset-x-0 bottom-0 z-[9999] p-4 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="max-w-2xl mx-auto bg-[var(--holo-panel)] border border-[var(--holo-border)] rounded-lg p-6"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="text-[var(--holo-accent)]" size={24} />
            <h3 className="text-lg text-[var(--holo-text)]">Sign in to Claude</h3>
          </div>
          <p className="text-sm text-[var(--holo-muted)] mb-4">
            The command palette uses your Anthropic subscription (Claude Pro/Max).
            Sign in to continue.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleAuth}
              className="px-4 py-2 bg-[var(--holo-accent)] text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              Sign in with Anthropic
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[9999] p-4 bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-w-3xl mx-auto bg-[var(--holo-panel)] border border-[var(--holo-border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Response area - only show if there are responses */}
        {(responses.length > 0 || error) && (
          <div
            ref={responseRef}
            className="max-h-64 overflow-y-auto p-4 border-b border-[var(--holo-border)]"
          >
            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
            {responses.map((r, i) => (
              <div key={i} className="text-sm">
                {r.type === 'tool_use' ? (
                  <span className="text-[var(--holo-accent)] opacity-70 text-xs">
                    {r.content}
                  </span>
                ) : (
                  <span className="text-[var(--holo-text)] whitespace-pre-wrap">
                    {r.content}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="flex items-center gap-3 p-4">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Claude anything... (Esc to cancel)"
            disabled={isProcessing}
            className="flex-1 bg-transparent text-[var(--holo-text)] placeholder-[var(--holo-muted)] focus:outline-none disabled:opacity-50"
          />

          {isProcessing ? (
            <Loader2 size={20} className="text-[var(--holo-accent)] animate-spin" />
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="text-[var(--holo-muted)] hover:text-[var(--holo-accent)] disabled:opacity-30 transition-colors"
            >
              <Send size={20} />
            </button>
          )}

          <button
            onClick={onClose}
            className="text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Hint */}
        <div className="px-4 pb-2 text-xs text-[var(--holo-muted)] flex items-center gap-4">
          <span>
            <kbd className="px-1 py-0.5 bg-[var(--holo-bg)] rounded border border-[var(--holo-border)]">Enter</kbd>
            {' '}Send
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-[var(--holo-bg)] rounded border border-[var(--holo-border)]">Esc</kbd>
            {' '}{isProcessing ? 'Cancel' : 'Close'}
          </span>
          {getCurrentFile() && (
            <span className="ml-auto truncate max-w-xs">
              Context: {getCurrentFile()?.split('/').pop()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
```

#### 3.2 Add to App Root (`src/App.tsx`)

```tsx
import { CommandPalette } from './components/CommandPalette/CommandPalette';

// In App component:
const [showCommandPalette, setShowCommandPalette] = useState(false);

useEffect(() => {
  const cleanup = window.electron.app.onMenuOpenCommandPalette(() => {
    setShowCommandPalette(true);
  });
  return cleanup;
}, []);

// In render:
{showCommandPalette && (
  <CommandPalette onClose={() => setShowCommandPalette(false)} />
)}
```

---

### Phase 4: OAuth Authentication

#### 4.1 Token Acquisition Flow

The Claude Agent SDK supports OAuth via `CLAUDE_CODE_OAUTH_TOKEN`. The flow:

1. **Check for existing token**: Look in environment or secure storage (Keychain on macOS)
2. **If no token**: Open browser to Anthropic's OAuth endpoint
3. **After auth**: Store token securely

```typescript
// electron/main/services/claudeAuthService.ts
import { shell } from 'electron';
import keytar from 'keytar';
import { createServer } from 'http';

const SERVICE_NAME = 'viewer-claude';
const ACCOUNT_NAME = 'oauth-token';

export class ClaudeAuthService {
  async getToken(): Promise<string | null> {
    // First check environment
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      return process.env.CLAUDE_CODE_OAUTH_TOKEN;
    }
    // Then check keychain
    return keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
  }

  async saveToken(token: string): Promise<void> {
    await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, token);
    // Also set in process env for SDK to pick up
    process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
  }

  async authenticate(): Promise<string> {
    // Start local callback server
    const port = await this.findAvailablePort();
    const callbackUrl = `http://localhost:${port}/callback`;

    return new Promise((resolve, reject) => {
      const server = createServer(async (req, res) => {
        const url = new URL(req.url!, `http://localhost:${port}`);
        if (url.pathname === '/callback') {
          const token = url.searchParams.get('token');
          if (token) {
            await this.saveToken(token);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Success!</h1><p>You can close this window.</p></body></html>');
            server.close();
            resolve(token);
          } else {
            res.writeHead(400);
            res.end('No token received');
            server.close();
            reject(new Error('No token received'));
          }
        }
      });

      server.listen(port, () => {
        // Open Anthropic OAuth page
        // Note: The exact OAuth URL would need to come from Anthropic's docs
        const authUrl = `https://console.anthropic.com/oauth/authorize?redirect_uri=${encodeURIComponent(callbackUrl)}`;
        shell.openExternal(authUrl);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('Authentication timed out'));
      }, 5 * 60 * 1000);
    });
  }

  private async findAvailablePort(): Promise<number> {
    // Find available port between 49152-65535
    // Implementation omitted for brevity
    return 51234;
  }
}
```

**Alternative: Reuse Claude Code's Token**

Since Claude Code already handles OAuth, we can potentially reuse its token:

```typescript
import { execSync } from 'child_process';

async getToken(): Promise<string | null> {
  try {
    // Run `claude setup-token` to get/refresh token
    const result = execSync('claude setup-token --print', { encoding: 'utf-8' });
    return result.trim();
  } catch {
    return null;
  }
}
```

This approach leverages the existing Claude Code CLI authentication.

---

### Phase 5: Polish & Settings

#### 5.1 Add Settings Panel Integration

Add to existing Settings app:

```tsx
// In InputSettings.tsx or new AISettings.tsx section

<SettingsSection title="AI Command Palette">
  <SettingRow
    label="Model"
    description="Claude model for quick commands"
  >
    <select value={settings.claude?.model || 'claude-sonnet-4'}>
      <option value="claude-sonnet-4">Claude Sonnet 4 (Fast)</option>
      <option value="claude-opus-4">Claude Opus 4 (Smart)</option>
      <option value="claude-haiku-3.5">Claude Haiku 3.5 (Fastest)</option>
    </select>
  </SettingRow>

  <SettingRow
    label="Permission Mode"
    description="How to handle file changes"
  >
    <select value={settings.claude?.permissionMode || 'acceptEdits'}>
      <option value="default">Ask for permission</option>
      <option value="acceptEdits">Auto-accept edits</option>
    </select>
  </SettingRow>

  <SettingRow label="Account">
    {isAuthenticated ? (
      <span className="text-green-400">Signed in</span>
    ) : (
      <button onClick={handleAuth}>Sign in</button>
    )}
  </SettingRow>
</SettingsSection>
```

#### 5.2 Create Zustand Store (`src/stores/claudeStore.ts`)

```typescript
import { create } from 'zustand';

interface ClaudeState {
  isAuthenticated: boolean;
  model: string;
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions';
  history: Array<{ prompt: string; response: string; timestamp: number }>;

  setAuthenticated: (value: boolean) => void;
  setModel: (model: string) => void;
  setPermissionMode: (mode: string) => void;
  addToHistory: (entry: { prompt: string; response: string }) => void;
  clearHistory: () => void;
}

export const useClaudeStore = create<ClaudeState>((set) => ({
  isAuthenticated: false,
  model: 'claude-sonnet-4',
  permissionMode: 'acceptEdits',
  history: [],

  setAuthenticated: (value) => set({ isAuthenticated: value }),
  setModel: (model) => set({ model }),
  setPermissionMode: (mode) => set({ permissionMode: mode as any }),
  addToHistory: (entry) => set(state => ({
    history: [...state.history.slice(-49), { ...entry, timestamp: Date.now() }]
  })),
  clearHistory: () => set({ history: [] })
}));
```

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `electron/main/services/claudeService.ts` | Claude Agent SDK wrapper |
| `electron/main/services/claudeAuthService.ts` | OAuth token management |
| `electron/main/ipc/claudeHandlers.ts` | IPC handlers for renderer |
| `src/components/CommandPalette/CommandPalette.tsx` | UI component |
| `src/components/CommandPalette/index.ts` | Export barrel |
| `src/stores/claudeStore.ts` | State management |

### Modified Files

| File | Changes |
|------|---------|
| `electron/main/index.ts` | Register claude handlers, add keyboard intercept |
| `electron/main/menu.ts` | Add AI menu with Cmd+/ shortcut |
| `electron/preload/index.ts` | Expose `window.electron.claude` API |
| `src/types/electron.d.ts` | Add ClaudeAPI type definitions |
| `src/App.tsx` | Add CommandPalette render and menu listener |
| `package.json` | Add `@anthropic-ai/claude-agent-sdk` dependency |

---

## Security Considerations

1. **Token Storage**: Use macOS Keychain via `keytar` for secure token storage
2. **Permission Mode**: Default to `acceptEdits` for quick commands, but allow `default` for cautious users
3. **Sandbox**: Consider enabling sandbox mode for untrusted projects
4. **No API Key Exposure**: Never expose tokens to renderer process - all SDK calls happen in main process

---

## Testing Plan

1. **Unit Tests**: Mock SDK responses, test store logic
2. **Integration Tests**:
   - Auth flow with test token
   - Query/abort lifecycle
   - IPC message passing
3. **E2E Tests**:
   - Cmd+/ opens palette
   - Simple query works
   - Escape cancels/closes
   - File context is passed correctly

---

## Future Enhancements

1. **Command History**: Up arrow to cycle through previous commands
2. **Slash Commands**: `/edit`, `/explain`, `/refactor` shortcuts
3. **Context Selection**: Select text in editor, then Cmd+/ to ask about selection
4. **Multi-Turn**: Keep conversation context for follow-up questions
5. **Custom MCP Tools**: Integrate Viewer-specific tools (open file, create window, etc.)

---

## Dependencies

```json
{
  "@anthropic-ai/claude-agent-sdk": "^0.2.37",
  "keytar": "^7.9.0"  // For secure token storage
}
```

---

## Timeline Estimate

| Phase | Effort | Notes |
|-------|--------|-------|
| Phase 1: Core Infrastructure | 4-6 hours | SDK integration, IPC setup |
| Phase 2: Menu & Shortcut | 1 hour | Simple menu/keyboard additions |
| Phase 3: UI Component | 3-4 hours | CommandPalette with streaming |
| Phase 4: OAuth | 2-3 hours | Token management |
| Phase 5: Polish | 2-3 hours | Settings, store, edge cases |

**Total: ~12-17 hours**

---

## References

- [Claude Agent SDK TypeScript Docs](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [NPM Package](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- [OAuth Demo](https://github.com/weidwonder/claude_agent_sdk_oauth_demo)
- [Claude Code OAuth Issue](https://github.com/anthropics/claude-code/issues/6536)
