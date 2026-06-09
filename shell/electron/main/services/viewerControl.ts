/**
 * Viewer control dispatch — the single seam between a main-process caller and
 * the renderer's `window.__viewerControl` bridge (see src/utils/controlBridge.ts).
 *
 * Both the legacy :7434 ControlServer and the Lattice mesh node (viewerNode.ts)
 * translate their requests into the SAME `(action, params)` calls and run them
 * through `executeViewerControl`, so there is exactly one place that knows how a
 * control action reaches the renderer.
 */
import type { BrowserWindow } from 'electron'

/** An action name + params pair, resolved against the renderer control bridge. */
export type ControlDispatch = (
  action: string,
  params?: Record<string, unknown>,
) => Promise<unknown>

export function executeViewerControl(
  mainWindow: BrowserWindow | null,
  action: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.reject(new Error('No main window available'))
  }
  return mainWindow.webContents.executeJavaScript(
    `window.__viewerControl.execute(${JSON.stringify(action)}, ${JSON.stringify(params)})`,
  ) as Promise<unknown>
}
