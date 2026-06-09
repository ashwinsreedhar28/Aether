/**
 * Keyboard shortcut catalog for the viewer.
 *
 * Each entry documents a real shortcut implemented somewhere in the codebase.
 * When you add a new shortcut, add it here too — this is the single
 * source of truth for the user-facing reference.
 *
 * Format conventions:
 * - Use Mod for "Cmd on macOS / Ctrl elsewhere" (rendered as ⌘ or Ctrl).
 * - Use Shift / Alt / Ctrl explicitly when the platform is universal.
 * - Combine with + (e.g. "Mod+K", "Mod+Shift+P").
 * - Use lowercase letters for letter keys ("Mod+k", not "Mod+K").
 *   The renderer will uppercase visually.
 */

export interface Shortcut {
  /** Human-readable description of what the shortcut does */
  description: string;
  /**
   * Key combination(s). If multiple combinations work, pass an array.
   * Examples: "Mod+k", ["ArrowUp", "k"], "Esc"
   */
  keys: string | string[];
}

export interface ShortcutGroup {
  /** Group name (e.g. "Global", "Kanban", "Markdown Editor") */
  scope: string;
  /** Optional one-line description of the scope */
  hint?: string;
  shortcuts: Shortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    scope: 'Global',
    hint: 'Available anywhere in the viewer.',
    shortcuts: [
      { description: 'Open command palette', keys: 'Mod+k' },
      { description: 'Open search', keys: 'Mod+f' },
      { description: 'Close current tab', keys: 'Mod+w' },
      { description: 'New tab in active window', keys: 'Mod+t' },
      { description: 'Cycle to next tab', keys: 'Mod+Alt+ArrowRight' },
      { description: 'Cycle to previous tab', keys: 'Mod+Alt+ArrowLeft' },
      { description: 'Close any open modal / dialog', keys: 'Esc' },
      { description: 'Submit / confirm in dialogs', keys: 'Mod+Enter' },
    ],
  },
  {
    scope: 'Command Palette',
    hint: 'When the command palette is open.',
    shortcuts: [
      { description: 'Move selection down', keys: 'ArrowDown' },
      { description: 'Move selection up', keys: 'ArrowUp' },
      { description: 'Run selected command', keys: 'Enter' },
      { description: 'Close palette', keys: 'Esc' },
    ],
  },
  {
    scope: 'File Explorer',
    hint: 'Navigating the left-side file tree.',
    shortcuts: [
      { description: 'Move selection down', keys: 'ArrowDown' },
      { description: 'Move selection up', keys: 'ArrowUp' },
      { description: 'Expand / open selected', keys: ['ArrowRight', 'Enter'] },
      { description: 'Collapse selected', keys: 'ArrowLeft' },
      { description: 'Rename selected', keys: 'F2' },
      { description: 'Delete selected', keys: ['Delete', 'Backspace'] },
    ],
  },
  {
    scope: 'Markdown Editor',
    hint: 'Editing .md files.',
    shortcuts: [
      { description: 'Save', keys: 'Mod+s' },
      { description: 'Toggle preview / source', keys: 'Mod+Shift+p' },
      { description: 'Bold selection', keys: 'Mod+b' },
      { description: 'Italic selection', keys: 'Mod+i' },
      { description: 'Insert link', keys: 'Mod+k' },
      { description: 'Find in document', keys: 'Mod+f' },
    ],
  },
  {
    scope: 'Kanban Board',
    hint: 'When a kanban file is focused. Press ? for inline help.',
    shortcuts: [
      { description: 'Show inline help overlay', keys: '?' },
      { description: 'New card in focused column', keys: 'n' },
      { description: 'Open / edit selected card', keys: 'Enter' },
      { description: 'Move selection up', keys: ['ArrowUp', 'k'] },
      { description: 'Move selection down', keys: ['ArrowDown', 'j'] },
      { description: 'Move selection left (column)', keys: ['ArrowLeft', 'h'] },
      { description: 'Move selection right (column)', keys: ['ArrowRight', 'l'] },
      { description: 'Move card up within column', keys: 'Shift+ArrowUp' },
      { description: 'Move card down within column', keys: 'Shift+ArrowDown' },
      { description: 'Move card to previous column', keys: 'Shift+ArrowLeft' },
      { description: 'Move card to next column', keys: 'Shift+ArrowRight' },
      { description: 'Close modal / clear selection', keys: 'Esc' },
    ],
  },
  {
    scope: 'Knowledge Graph',
    hint: 'Navigating and editing the graph canvas.',
    shortcuts: [
      { description: 'Open search panel', keys: 'Mod+f' },
      { description: 'Add new node at center', keys: 'n' },
      { description: 'Delete selected node / edge', keys: ['Delete', 'Backspace'] },
      { description: 'Zoom in', keys: ['Mod+=', 'Mod++'] },
      { description: 'Zoom out', keys: 'Mod+-' },
      { description: 'Reset zoom / fit graph', keys: 'Mod+0' },
      { description: 'Confirm edge label', keys: 'Enter' },
      { description: 'Cancel edit', keys: 'Esc' },
    ],
  },
  {
    scope: 'Terminal',
    hint: 'Inside a terminal tab.',
    shortcuts: [
      { description: 'Copy selection', keys: 'Mod+c' },
      { description: 'Paste', keys: 'Mod+v' },
      { description: 'Clear screen', keys: 'Mod+k' },
      { description: 'Interrupt running process', keys: 'Ctrl+c' },
      { description: 'Send EOF', keys: 'Ctrl+d' },
    ],
  },
  {
    scope: 'API Manager',
    hint: 'Building and sending requests.',
    shortcuts: [
      { description: 'Send request', keys: 'Mod+Enter' },
      { description: 'Focus URL bar', keys: 'Mod+l' },
      { description: 'Save request', keys: 'Mod+s' },
    ],
  },
  {
    scope: 'Browser',
    hint: 'Inside the embedded browser tab.',
    shortcuts: [
      { description: 'Focus address bar', keys: 'Mod+l' },
      { description: 'Reload page', keys: 'Mod+r' },
      { description: 'Hard reload', keys: 'Mod+Shift+r' },
      { description: 'Go back', keys: 'Mod+ArrowLeft' },
      { description: 'Go forward', keys: 'Mod+ArrowRight' },
    ],
  },
  {
    scope: 'Mermaid / Diagram Viewers',
    hint: 'Diagram and graph preview windows.',
    shortcuts: [
      { description: 'Zoom in', keys: ['Mod+=', 'Mod++'] },
      { description: 'Zoom out', keys: 'Mod+-' },
      { description: 'Reset view', keys: 'Mod+0' },
      { description: 'Fit to window', keys: 'f' },
    ],
  },
  {
    scope: 'Dictation',
    hint: 'When dictation is enabled (see Settings).',
    shortcuts: [
      { description: 'Toggle dictation', keys: 'Mod+Shift+d' },
      { description: 'Stop and discard transcript', keys: 'Esc' },
    ],
  },
  {
    scope: 'Calculator',
    hint: 'When the calculator app is focused.',
    shortcuts: [
      { description: 'Digits and decimal', keys: '0-9, .' },
      { description: 'Operators', keys: '+, -, *, /' },
      { description: 'Evaluate', keys: ['=', 'Enter'] },
      { description: 'Clear all', keys: ['c', 'Esc'] },
      { description: 'Backspace last digit', keys: 'Backspace' },
    ],
  },
];

/**
 * Helper: detect platform for rendering Mod as ⌘ or Ctrl.
 * Falls back gracefully outside the browser.
 */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || navigator.platform || '';
  return /Mac|iPhone|iPad|iPod/i.test(ua);
}

/**
 * Render a single key segment for display.
 * Converts "Mod" to platform glyph and pretty-prints common keys.
 */
export function renderKey(segment: string, mac: boolean): string {
  const map: Record<string, string> = {
    Mod: mac ? '⌘' : 'Ctrl',
    Ctrl: mac ? '⌃' : 'Ctrl',
    Alt: mac ? '⌥' : 'Alt',
    Shift: mac ? '⇧' : 'Shift',
    Enter: '↵',
    Esc: 'Esc',
    Backspace: '⌫',
    Delete: 'Del',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };
  if (segment in map) return map[segment];
  if (segment.length === 1) return segment.toUpperCase();
  return segment;
}

/**
 * Render a key combination string (e.g. "Mod+Shift+p") into display tokens.
 */
export function renderCombo(combo: string, mac: boolean): string[] {
  return combo.split('+').map((s) => renderKey(s.trim(), mac));
}
