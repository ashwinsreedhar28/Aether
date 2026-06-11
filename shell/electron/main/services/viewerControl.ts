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
  // The bridge RESOLVES failures into a { __controlError } envelope instead of
  // rejecting (#300): a rejected renderer promise is the one executeJavaScript
  // shape whose transport is unreliable — it can leave this promise pending
  // forever (the lane recipe hung exactly there, with neither spawned nor
  // failed written). Unwrap the envelope back into a real rejection so every
  // caller still sees errors as errors, deterministically.
  return (
    mainWindow.webContents.executeJavaScript(
      `window.__viewerControl.execute(${JSON.stringify(action)}, ${JSON.stringify(params)})`,
    ) as Promise<unknown>
  ).then((res) => {
    const ctrlErr = (res as { __controlError?: unknown } | null | undefined)?.__controlError
    if (typeof ctrlErr === 'string') throw new Error(ctrlErr)
    return res
  })
}
