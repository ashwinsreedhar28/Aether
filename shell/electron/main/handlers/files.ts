import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, sep } from 'node:path'

// 1 MiB. The shell renders strings synchronously in react-markdown; bigger
// inputs lag the first paint visibly. Raise once we have lazy/virtualised
// rendering — until then, the cap is the contract.
const MAX_BYTES = 1024 * 1024

export interface OpenDialogOptions {
  filters?: { name: string; extensions: string[] }[]
}

// Allowed read roots. The dialog itself is the trust boundary for
// user-chosen files, but `readText` is also reachable directly from the
// renderer — including the DevTools console — so we still enforce an
// allowlist. Anchored to OS-reported roots, so paths under e.g. `/etc`
// or `/System` are rejected without us having to enumerate every system
// location. `path.sep` is included so the prefix check can't be tricked
// by a sibling named `<home>extra/`.
function allowedRoots(): string[] {
  const roots = [
    homedir(),
    app.getPath('userData'),
    app.getPath('downloads'),
    app.getPath('temp')
  ]
  // De-dup (downloads and temp can sit under home on some configs) and
  // ensure each ends with sep for boundary-safe startsWith.
  const seen = new Set<string>()
  return roots
    .map((r) => (r.endsWith(sep) ? r : r + sep))
    .filter((r) => {
      if (seen.has(r)) return false
      seen.add(r)
      return true
    })
}

function isUnderAllowedRoot(absolutePath: string): boolean {
  const withSep = absolutePath.endsWith(sep) ? absolutePath : absolutePath + sep
  return allowedRoots().some((root) => withSep.startsWith(root))
}

export function registerFileHandlers(): void {
  ipcMain.handle('files:openDialog', async (event, opts: OpenDialogOptions = {}) => {
    // Anchor the dialog to the requesting window so it appears as a sheet
    // on macOS — matches platform expectation for file pickers.
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: opts.filters
        })
      : await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: opts.filters
        })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('files:readText', async (_event, requestedPath: string) => {
    if (typeof requestedPath !== 'string' || requestedPath.length === 0) {
      throw new Error('files:readText: path must be a non-empty string')
    }
    const absolutePath = resolve(requestedPath)
    if (!isUnderAllowedRoot(absolutePath)) {
      throw new Error(
        `files:readText: path is outside the allowed roots (home / userData / downloads / temp): ${absolutePath}`
      )
    }
    // stat first so an oversized file is rejected without ever loading it
    // into a Buffer — and so the "too large" error is precise rather than
    // an OOM crash.
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile()) {
      throw new Error(`files:readText: not a regular file: ${absolutePath}`)
    }
    if (stat.size > MAX_BYTES) {
      throw new Error(
        `files:readText: file is ${stat.size} bytes; ${MAX_BYTES}-byte cap exceeded`
      )
    }
    return fs.readFile(absolutePath, 'utf-8')
  })
}
