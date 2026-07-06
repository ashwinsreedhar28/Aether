// Disposition routing for window-open requests surfaced from the browser
// app's <webview> guest (#336). Electron ≥22 removed the webview `new-window`
// DOM event, so these requests only exist in the main process
// (setWindowOpenHandler on the guest webContents); main denies the native
// popup and forwards { url, disposition } to the renderer, which decides here.
//
// Pure — no React, no Electron — so it runs under Node's built-in test
// runner like regionResolver/laneGate:
//   node --test shell/src/apps/browser/windowOpenRouter.test.ts
// The constants import carries a .ts extension for the same reason (see
// tsconfig's allowImportingTsExtensions note).
import { BLOCKED_PROTOCOLS } from './constants.ts';

/** Dispositions that create a NEW shell tab running the Browser app.
 *  Everything else (the `default` disposition, `save-to-disk`, `other`)
 *  keeps the legacy same-webview behavior. */
export const TAB_DISPOSITIONS = ['foreground-tab', 'background-tab', 'new-window'] as const;

export interface WindowOpenDetails {
  url: string;
  /** Electron's WindowOpenHandlerDetails.disposition, forwarded verbatim. */
  disposition: string;
}

/**
 * The full `browser:window-open` IPC payload main forwards. Mirrors the
 * preload's BrowserWindowOpenDetails — preload and renderer don't share
 * imports (the laneGate precedent: each side pins its copy).
 */
export interface ForwardedWindowOpenDetails extends WindowOpenDetails {
  /** webContents.id of the guest that asked — consumers filter on it. */
  sourceWebContentsId: number;
}

export interface WindowOpenHandlers {
  /** Open a new shell tab running the Browser app at the URL. */
  openTab: (url: string, opts: { background: boolean }) => void;
  /** Load the URL in the requesting webview (legacy same-webview path). */
  loadInPlace: (url: string) => void;
}

export type WindowOpenOutcome = 'tab' | 'in-place' | 'blocked';

/**
 * Route one window-open request. BLOCKED_PROTOCOLS is enforced before either
 * path, exactly as will-navigate enforces it; an unparseable URL is refused
 * the same way will-navigate refuses it (block on parse failure).
 */
export function routeWindowOpen(
  details: WindowOpenDetails,
  handlers: WindowOpenHandlers,
): WindowOpenOutcome {
  let protocol: string;
  try {
    protocol = new URL(details.url).protocol;
  } catch {
    return 'blocked';
  }
  if (BLOCKED_PROTOCOLS.includes(protocol)) {
    return 'blocked';
  }

  if ((TAB_DISPOSITIONS as readonly string[]).includes(details.disposition)) {
    handlers.openTab(details.url, { background: details.disposition === 'background-tab' });
    return 'tab';
  }

  handlers.loadInPlace(details.url);
  return 'in-place';
}
