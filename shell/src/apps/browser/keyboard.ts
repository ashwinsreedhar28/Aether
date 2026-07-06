// Key → action decision for the Browser app's isActive-gated keydown handler
// (#336). Pure — no React, no DOM — so it runs under Node's built-in test
// runner like regionResolver/laneGate:
//   node --test shell/src/apps/browser/keyboard.test.ts
//
// cmd+w is deliberately ABSENT: the shell already owns close-tab
// (viewerMenu.ts binds CmdOrCtrl+W → 'menu:close-tab' → Desktop's
// closeFocusedWindowOrTab). Binding it here would double-close.

export type BrowserKeyAction = 'refresh' | 'back' | 'forward' | 'new-tab';

export interface KeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
}

export function browserKeyAction(input: KeyInput): BrowserKeyAction | null {
  if (!input.metaKey && !input.ctrlKey) return null;
  switch (input.key) {
    case 'r':
      return 'refresh';
    case '[':
      return 'back';
    case ']':
      return 'forward';
    case 't':
      return 'new-tab';
    default:
      return null;
  }
}
