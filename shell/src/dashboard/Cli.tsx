import { useRef, useState } from 'react'

// The intent shape the CLI submits. Sprint 6.3 designs this as one of two
// intent sources (CLI + voice) per the roadmap; for 6.3b the CLI POSTs the
// panel directly to the scene server to prove the transport round-trip. The
// transform/size are required by the scene server's Panel model even though the
// 2D dashboard ignores position (layout is arrival-order column). style values
// MUST be strings — the AVP client decodes style as [String: String] and a
// non-string value silently kills the decode (governance-log 2026-05-26).
function makeTextPanel(text: string): Record<string, unknown> {
  return {
    id: `cli-${Date.now()}`,
    kind: 'text',
    text,
    transform: { position: [0, 1.5, -1.3], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: { width: 0.5, height: 0.3 },
    style: { source: 'cli' }, // string values only (governance-log 2026-05-26)
  }
}

// Permanent bottom input strip, Claude-Code-style. Input + inline error only —
// no scrolling transcript area (deferred; voice transcripts land in 6.5).
export function Cli(): React.ReactElement {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  // In-memory only; no persistence needed this lane. `historyIdx === null`
  // means the user is editing a fresh line rather than recalling history.
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState<number | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const submit = async (): Promise<void> => {
    const text = value.trim()
    if (!text) return
    const result = await window.aether.scene.postPanel(makeTextPanel(text))
    if (!result.ok) {
      const status = result.status ? ` (${result.status})` : ''
      setError(`POST failed${status}: ${result.error ?? 'unknown error'}`)
      return
    }
    // Success: record history and clear. We deliberately do NOT add the panel
    // to dashboard state here — it arrives via the scene-server delta, which
    // proves the CLI → server → subscriber → dashboard round-trip end to end.
    setError(null)
    setHistory((h) => [...h, text])
    setHistoryIdx(null)
    setValue('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const ta = e.currentTarget

    // Enter submits; Shift+Enter inserts a newline (multi-line input).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
      return
    }

    // ArrowUp recalls older commands, but only when the caret is at the very
    // start — otherwise it should move the caret within a multi-line draft.
    if (e.key === 'ArrowUp' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      if (history.length === 0) return
      e.preventDefault()
      const idx = historyIdx === null ? history.length - 1 : Math.max(0, historyIdx - 1)
      const recalled = history[idx]
      if (recalled === undefined) return
      setHistoryIdx(idx)
      setValue(recalled)
      return
    }

    // ArrowDown walks forward through history, only when the caret is at the
    // end. Past the newest entry returns to an empty fresh line.
    if (e.key === 'ArrowDown' && ta.selectionStart === value.length && ta.selectionEnd === value.length) {
      if (historyIdx === null) return
      e.preventDefault()
      const idx = historyIdx + 1
      const recalled = history[idx]
      if (idx >= history.length || recalled === undefined) {
        setHistoryIdx(null)
        setValue('')
      } else {
        setHistoryIdx(idx)
        setValue(recalled)
      }
    }
  }

  return (
    <div
      className="shrink-0 border-t"
      style={{ borderColor: 'var(--holo-border)', background: 'var(--holo-panel)' }}
    >
      {error && (
        <div
          className="px-4 py-1 text-xs font-mono"
          style={{ color: '#ff6b6b' }}
          role="alert"
        >
          {error}
        </div>
      )}
      <div className="flex items-start gap-2 px-4 py-2">
        <span
          className="font-mono text-sm select-none pt-px"
          style={{ color: 'var(--holo-accent)' }}
          aria-hidden
        >
          ❯
        </span>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            // Editing detaches from recalled history into a fresh draft.
            setHistoryIdx(null)
          }}
          onKeyDown={onKeyDown}
          rows={1}
          spellCheck={false}
          placeholder="Type a command — Enter to send, Shift+Enter for newline"
          className="flex-1 bg-transparent outline-none resize-none font-mono text-sm placeholder:opacity-40"
          style={{ color: 'var(--holo-text)' }}
        />
      </div>
    </div>
  )
}
