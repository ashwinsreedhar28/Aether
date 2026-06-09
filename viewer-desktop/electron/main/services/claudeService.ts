/**
 * Claude Service
 * Wraps the Claude Agent SDK for the command palette feature.
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

// Dynamic import to avoid require() of ESM module in CJS context
const getSDK = () => import('@anthropic-ai/claude-agent-sdk');

// Static viewer-ctl CLI documentation embedded from AGENTS-VIEWER.md
const VIEWER_CTL_DOCS = `# Viewer Control — Agent Guidelines

> You have a display. Use it. When something is relevant, show it. When it stops being relevant, clean it up. The user should never have to ask you to open or close things — you just do it, like Jarvis.

## Core Philosophy

You are working inside a project that has a **viewer application** running alongside you. The viewer is your display surface — it can render markdown, code, diagrams, images, PDFs, HTML, and more. You control it with the \`viewer-ctl\` CLI.

**Show, don't tell.** If you mention a file, open it. If you create a diagram, display it. If you write an HTML report, show it. The user is looking at the viewer — put things there instead of dumping text into the terminal.

---

## Behavior Rules

### 1. Proactively show relevant content

When your work produces or references something visual, open it in the viewer automatically.

**Do this:**
- You create a mermaid diagram → write the \`.mmd\` file → \`viewer-ctl open diagram.mmd\`
- You generate an HTML report → write the \`.html\` file → \`viewer-ctl open report.html\`
- You're explaining a file → \`viewer-ctl open src/auth/login.ts\` so the user can see it
- You find relevant docs → \`viewer-ctl open docs/architecture.md\`
- The user asks about images → \`viewer-ctl open assets/logo.png\`

**Don't do this:**
- Open every file you read during research (too noisy)
- Open files the user didn't ask about and aren't directly relevant
- Open the same file twice (viewer-ctl deduplicates, but be intentional)

### 2. Check before you act

Before opening files, check what's already visible. Don't flood the viewer.

\`\`\`bash
# See what's already open
viewer-ctl list
\`\`\`

Use the output to decide whether to open new windows or reuse existing ones.

### 3. Arrange windows thoughtfully

When showing multiple related files, arrange them so the user can see everything at once.

\`\`\`bash
# Show two files side by side
viewer-ctl open src/api/routes.ts src/api/handlers.ts
viewer-ctl layout split

# Show three related files
viewer-ctl open src/model.ts src/controller.ts src/view.ts
viewer-ctl layout thirds

# Show four files in quadrants
viewer-ctl open file1.ts file2.ts file3.ts file4.ts
viewer-ctl layout quarters

# Auto-tile everything that's open
viewer-ctl layout tile
\`\`\`

When showing a single important file, use focus layout:
\`\`\`bash
viewer-ctl open README.md
viewer-ctl layout focus
\`\`\`

### 4. Clean up when done

If you opened windows for a specific task and that task is complete, close them. Don't leave stale windows cluttering the viewer.

\`\`\`bash
# Check what's open
viewer-ctl list
# Close a window you no longer need
viewer-ctl close --window <window-id>
\`\`\`

Use your judgment — if the user might still want to look at something, leave it open. If it was temporary scaffolding (a diagram you generated to explain something), close it when the conversation moves on.

### 5. Create visualizations when they help

The viewer supports mermaid diagrams (\`.mmd\`), HTML (\`.html\`), and markdown (\`.md\`). When a visual explanation would be clearer than text, create one and show it.

**Architecture overview:**
\`\`\`bash
cat > architecture.mmd << 'EOF'
graph TD
    A[Client] --> B[API Gateway]
    B --> C[Auth Service]
    B --> D[User Service]
    C --> E[(Database)]
    D --> E
EOF
viewer-ctl open architecture.mmd
\`\`\`

**Rich report:**
\`\`\`bash
cat > analysis.html << 'EOF'
<html><body style="background:#0a0a0f;color:#e0e0e0;font-family:monospace;padding:2rem">
<h1>Code Analysis</h1>
<!-- your content -->
</body></html>
EOF
viewer-ctl open analysis.html
\`\`\`

**Important:** Always write generated files to the project working directory (or a subdirectory of it), not \`/tmp/\`. The viewer can only access files within its workspace path.

### 6. Use the right app for the job

The viewer auto-detects file types, but you can force a specific app:

\`\`\`bash
# Force a file to open in a specific viewer
viewer-ctl open data.json              # auto-detects json-viewer
viewer-ctl open styles.css             # auto-detects text-editor
viewer-ctl open diagram.mmd           # auto-detects mermaid-viewer

# Open standalone apps
viewer-ctl open --app settings         # Settings panel
viewer-ctl open --app terminal         # New terminal
viewer-ctl open --app browser          # Web browser
viewer-ctl open --app calculator       # Calculator
viewer-ctl open --app knowledge-graph  # Mind map
\`\`\`

### 7. Be tasteful

Not everything needs to be shown. Use the viewer when it genuinely helps the user understand or interact with something. A few well-chosen windows are better than a wall of open files.

---

## CLI Reference

All commands output JSON by default (for agent parsing). Add \`--human\` for colored human-readable output.

### \`viewer-ctl status\`
Check if the viewer is running. **Call this before other commands** if you're unsure.
\`\`\`bash
viewer-ctl status
# → {"ok":true,"status":"running","port":7434,"pid":12345,"bridgeReady":true}
\`\`\`

### \`viewer-ctl open <path> [<path2> ...]\`
Open one or more files. Each file opens in its own new window by default.
\`\`\`bash
viewer-ctl open src/App.tsx
viewer-ctl open src/App.tsx src/main.ts README.md
viewer-ctl open --tab src/App.tsx  # Add as tab to focused window
\`\`\`

### \`viewer-ctl open --app <app-id>\`
Open a standalone app (no file needed).
\`\`\`bash
viewer-ctl open --app settings
viewer-ctl open --app terminal
viewer-ctl open --app browser
\`\`\`

### \`viewer-ctl list\`
Get the full state of all workspaces, windows, and tabs.

### \`viewer-ctl apps\`
List all available apps and their supported file types.

### \`viewer-ctl layout <preset>\`
Arrange windows: \`focus\`, \`split\`, \`thirds\`, \`quarters\`, \`tile\`.

### \`viewer-ctl close --window <id> [--tab <id>]\`
Close a window or a specific tab within a window. Get IDs from \`viewer-ctl list\`.

### \`viewer-ctl focus <window-id>\`
Bring a window to the front.

### \`viewer-ctl workspace <path|list>\`
Open a directory as a workspace or list open workspaces.

### \`viewer-ctl terminal [--cwd <dir>]\`
Open a new terminal window.

### \`viewer-ctl terminal --write <session-id> --data <text>\`
Write text to an existing terminal session.

---

## Supported File Types

| Extension | App |
|-----------|-----|
| \`.md\`, \`.markdown\` | Markdown Editor |
| \`.json\` | JSON Viewer |
| \`.pdf\` | PDF Viewer |
| \`.png\`, \`.jpg\`, \`.gif\`, \`.svg\`, \`.webp\`, \`.ico\`, \`.bmp\` | Image Viewer |
| \`.html\`, \`.htm\` | HTML Preview |
| \`.mmd\`, \`.mermaid\` | Mermaid Viewer |
| \`.tex\`, \`.latex\` | LaTeX Viewer |
| \`.js\`, \`.ts\`, \`.tsx\`, \`.py\`, \`.go\`, \`.rs\`, \`.c\`, \`.cpp\`, etc. | Text Editor |
| Everything else | Text Editor |`;

export interface ClaudeQueryOptions {
  prompt: string;
  cwd: string;
  currentFile?: string;
  model?: string;
  resume?: string;
  openFiles?: string[];
  onMessage: (msg: SDKMessage) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

export class ClaudeService {
  private abortController: AbortController | null = null;

  async query(options: ClaudeQueryOptions): Promise<void> {
    this.abortController = new AbortController();
    return this.queryDirect(options);
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async getAuthStatus(): Promise<{ authenticated: boolean; email?: string }> {
    // The Agent SDK resolves credentials from multiple sources automatically
    // (CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY, `claude login` session, etc.).
    // Skip pre-flight checks — let the SDK resolve auth at query time.
    // If credentials are missing, the SDK will throw and the error will surface
    // in the command palette's error UI.
    return { authenticated: true };
  }

  private async queryDirect(options: ClaudeQueryOptions): Promise<void> {
    const systemPrompt = this.buildSystemPrompt(options);
    const { query } = await getSDK();

    const q = query({
      prompt: options.prompt,
      options: {
        cwd: options.cwd,
        abortController: this.abortController!,
        tools: { type: 'preset', preset: 'claude_code' },
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: systemPrompt,
        },
        includePartialMessages: true,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: ['project'],
        maxTurns: 10,
        model: options.model,
        resume: options.resume,
      },
    });

    try {
      for await (const message of q) {
        options.onMessage(message);
      }
      options.onComplete();
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        options.onError(error);
      }
    }
  }

  private buildSystemPrompt(options: ClaudeQueryOptions): string {
    const sections: string[] = [];

    // Section A: Identity & context
    sections.push(`
You are an AI assistant embedded in the R.A.V.E.N. Viewer — a desktop application that renders files (code, markdown, diagrams, images, PDFs, HTML, and more). You have a display surface. When something is relevant, show it. When it stops being relevant, clean it up. The user should never have to ask you to open or close things — you just do it, like Jarvis.

Be concise. This is a command palette for quick tasks.`);

    // Section B: Workspace & open files
    let filesContext = `\nWorkspace: ${options.cwd}`;
    if (options.currentFile) {
      filesContext += `\nCurrently focused file: ${options.currentFile}`;
    }
    if (options.openFiles && options.openFiles.length > 0) {
      filesContext += `\n\nFiles currently open in the viewer:`;
      for (const file of options.openFiles) {
        const isFocused = file === options.currentFile;
        filesContext += `\n- ${file}${isFocused ? ' (focused)' : ''}`;
      }
    }
    sections.push(filesContext);

    // Section C: Style guide for generated content
    sections.push(`
## Style Guide for Generated Content

When creating content to display to the user, **prefer HTML files** over markdown unless the user specifically requests markdown. Style generated HTML to match the viewer aesthetic:
- Dark theme: background \`#0a0a0f\`, text \`#e0e0e0\`, accent colors in cyan/blue tones
- Monospace fonts (\`font-family: 'Courier New', monospace\`)
- Clean, minimal layouts with good spacing
- Use semantic HTML and inline styles — no external CSS dependencies
- For diagrams, use \`.mmd\` (mermaid) files
- Always write generated files to the project working directory, not /tmp/`);

    // Section D: Viewer-ctl CLI reference
    sections.push(`\n## Viewer Control CLI Reference\n\n${VIEWER_CTL_DOCS}`);

    return sections.join('\n');
  }
}

export const claudeService = new ClaudeService();
