import { execFile } from 'node:child_process'

export type AppleScriptError =
  | 'permission_denied'
  | 'timeout'
  | 'syntax'
  | 'unknown'

export type AppleScriptResult =
  | { ok: true; output: string }
  | { ok: false; error: AppleScriptError; message: string }

export interface RunAppleScriptOptions {
  /** Hard timeout for the osascript invocation. Defaults to 30000ms. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

// osascript's stderr text on a TCC / Automation denial varies slightly
// across macOS releases (10.14+: parenthetical AppleEvent error code,
// 13+: human-readable "Not authorized to send Apple events"). We
// recognize both forms.
function classifyStderr(stderr: string): AppleScriptError | null {
  const s = stderr.toLowerCase()
  if (s.includes('(-1743)') || s.includes('not authorized')) {
    return 'permission_denied'
  }
  if (s.includes('syntax error')) {
    return 'syntax'
  }
  return null
}

interface ExecError extends Error {
  code?: number | string | null
  killed?: boolean
  signal?: NodeJS.Signals | null
  stdout?: string
  stderr?: string
}

// Invoke an AppleScript snippet via `osascript -e <script>` and return
// a discriminated result. The bridge never throws on script-level
// failure — callers branch on `result.ok`. It still throws for
// `osascript`-binary-missing or other unexpected exec setup errors,
// which would indicate the host isn't macOS at all.
export function runAppleScript(
  script: string,
  options: RunAppleScriptOptions = {},
): Promise<AppleScriptResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise<AppleScriptResult>((resolve) => {
    execFile(
      'osascript',
      ['-e', script],
      // maxBuffer default (1 MiB) is plenty for the TSV outputs we
      // currently produce. If a future consumer needs more, bump this
      // explicitly rather than streaming — AppleScript output is
      // typically small and discrete.
      { timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err === null) {
          resolve({ ok: true, output: stdout })
          return
        }

        const e = err as ExecError
        const stderrText = (e.stderr ?? stderr ?? '').toString()

        // execFile signals timeout by killing the child with SIGTERM
        // and setting `killed = true`. That's distinct from a manual
        // user kill (which would never happen here), so we can use it
        // as the timeout discriminator.
        if (e.killed === true && e.signal === 'SIGTERM') {
          resolve({
            ok: false,
            error: 'timeout',
            message: `osascript exceeded ${timeoutMs}ms`,
          })
          return
        }

        const classified = classifyStderr(stderrText)
        if (classified !== null) {
          resolve({
            ok: false,
            error: classified,
            message: stderrText.trim() || e.message,
          })
          return
        }

        resolve({
          ok: false,
          error: 'unknown',
          message: (stderrText.trim() || e.message || '').slice(0, 2000),
        })
      },
    )
  })
}
