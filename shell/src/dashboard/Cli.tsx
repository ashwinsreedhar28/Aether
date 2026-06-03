import { useEffect, useRef, useState } from 'react'
import type { TranscriptEntry } from '../../electron/preload'

// The panel shape posted by the '/post <text>' escape hatch. Default CLI input
// now routes to raven (one brain — see submit); /post retains the original
// direct-to-scene-server round-trip that proved the transport in Sprint 6.3b.
// The transform/size are required by the scene server's Panel model even though
// the 2D dashboard ignores position (layout is arrival-order column). style
// values MUST be strings — the AVP client decodes style as [String: String] and
// a non-string value silently kills the decode (governance-log 2026-05-26).
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

// Permanent bottom input strip, Claude-Code-style: a scrolling transcript echo
// above a single input line. The echo subscribes to voice.onTranscript — the
// same push channel the voice path uses — so a typed conversation reads exactly
// like a spoken one (one brain). Typed turns don't produce a 'user' transcript
// (no audio to transcribe), so we echo the accepted line optimistically; raven's
// reply arrives as 'raven' fragments via output_audio_transcription.
//
// The inline ✓/✗ line below the input is reserved for send-time acks that the
// echo can't carry: /post confirmation and ✗ errors (cold mic, bad command).
type Feedback = { kind: 'ok' | 'err'; text: string }

// One chat bubble in the echo. Adjacent same-speaker transcript fragments are
// concatenated into a single line (transcription arrives incrementally).
type LogLine = { id: string; speaker: TranscriptEntry['speaker']; text: string }

const SPEAKER_LABEL: Record<TranscriptEntry['speaker'], string> = {
  user: 'you',
  raven: 'aether',
  system: 'system',
}

export function Cli(): React.ReactElement {
  const [value, setValue] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  // In-memory only; no persistence needed this lane. `historyIdx === null`
  // means the user is editing a fresh line rather than recalling history.
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState<number | null>(null)
  const [log, setLog] = useState<LogLine[]>([])
  const taRef = useRef<HTMLTextAreaElement>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  // Append a transcript fragment, merging it into the previous line when the
  // speaker hasn't changed (fragments reconstruct one utterance by
  // concatenation). Used by both the optimistic typed echo and the raven
  // reply push.
  const appendLine = (speaker: TranscriptEntry['speaker'], text: string): void => {
    if (!text) return
    setLog((prev) => {
      const last = prev[prev.length - 1]
      if (last && last.speaker === speaker) {
        const merged = { ...last, text: last.text + text }
        return [...prev.slice(0, -1), merged]
      }
      return [...prev, { id: `${speaker}-${Date.now()}-${prev.length}`, speaker, text }]
    })
  }

  // Subscribe to the voice transcript push (user utterances + raven replies).
  // This is the same channel the spoken path uses — typed and voice share it.
  useEffect(() => {
    const unsubscribe = window.aether.voice.onTranscript((entry) => {
      appendLine(entry.speaker, entry.text)
    })
    return unsubscribe
  }, [])

  // Keep the newest line in view.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [log])

  // Record into history and clear the draft. Only called on an accepted send.
  const commit = (entry: string): void => {
    setHistory((h) => [...h, entry])
    setHistoryIdx(null)
    setValue('')
  }

  const submit = async (): Promise<void> => {
    const text = value.trim()
    if (!text) return

    // Slash-commands are the escape hatch. '/post <text>' keeps the original
    // post-a-panel-to-the-scene behavior; anything else is reported, never
    // silently routed to the brain (a typo shouldn't become a spoken turn).
    if (text.startsWith('/')) {
      const sp = text.indexOf(' ')
      const cmd = (sp === -1 ? text : text.slice(0, sp)).toLowerCase()
      const rest = sp === -1 ? '' : text.slice(sp + 1).trim()
      if (cmd === '/post') {
        if (!rest) {
          setFeedback({ kind: 'err', text: '/post needs text — e.g. /post hello world' })
          return
        }
        const result = await window.aether.scene.postPanel(makeTextPanel(rest))
        if (!result.ok) {
          const status = result.status ? ` (${result.status})` : ''
          setFeedback({ kind: 'err', text: `POST failed${status}: ${result.error ?? 'unknown error'}` })
          return
        }
        // The panel lands via the scene-server delta, not local state — that
        // round-trip is the whole point of /post.
        setFeedback({ kind: 'ok', text: 'Panel posted' })
        commit(text)
        return
      }
      setFeedback({ kind: 'err', text: `Unknown command ${cmd} — just type to talk to Aether, or /post <text>` })
      return
    }

    // Default: route to raven. Typed and spoken commands reach one brain —
    // same tools, same routing, same spoken reply.
    const result = await window.aether.voice.sendText(text)
    if ('error' in result) {
      const reason =
        result.error === 'no_session'
          ? 'Aether is not listening (mic off?)'
          : result.error
      setFeedback({ kind: 'err', text: `Not sent: ${reason}` })
      return
    }
    // Accepted: echo the typed line into the transcript (no 'user' push comes
    // back for typed input) — that bubble IS the ack, so clear the ✓ line.
    // Raven's reply streams in as 'raven' fragments.
    appendLine('user', text)
    setFeedback(null)
    commit(text)
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
      {log.length > 0 && (
        <div className="max-h-48 overflow-y-auto px-4 py-2 font-mono text-xs leading-relaxed">
          {log.map((line) => (
            <div key={line.id} className="whitespace-pre-wrap break-words">
              <span
                className="select-none"
                style={{
                  color: line.speaker === 'raven' ? 'var(--holo-accent)' : 'var(--holo-muted)',
                }}
              >
                {SPEAKER_LABEL[line.speaker]}{' '}
              </span>
              <span style={{ color: 'var(--holo-text)' }}>{line.text}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}
      {feedback && (
        <div
          className="px-4 py-1 text-xs font-mono"
          style={{ color: feedback.kind === 'ok' ? 'var(--holo-accent)' : '#ff6b6b' }}
          role={feedback.kind === 'err' ? 'alert' : 'status'}
        >
          {feedback.kind === 'ok' ? '✓' : '✗'} {feedback.text}
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
            // Editing detaches from recalled history into a fresh draft and
            // dismisses any lingering ack from the previous send.
            setHistoryIdx(null)
            setFeedback(null)
          }}
          onKeyDown={onKeyDown}
          rows={1}
          spellCheck={false}
          placeholder="Message Aether — Enter to send · /post <text> to pin a panel"
          className="flex-1 bg-transparent outline-none resize-none font-mono text-sm placeholder:opacity-40"
          style={{ color: 'var(--holo-text)' }}
        />
      </div>
    </div>
  )
}
