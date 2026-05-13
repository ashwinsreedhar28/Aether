import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Mic, MicOff, Play, Square } from 'lucide-react'
import type {
  RavenState,
  RavenStatus,
  ToolCallEntry,
  TranscriptEntry,
  VoiceAvailability
} from '../../../electron/preload'

// Pill colour + label derive from {availability, ravenStatus}. Order
// matters — availability:unavailable beats any RavenStatus, since the
// daemon being down makes the status field irrelevant.
function pillFor(
  availability: VoiceAvailability,
  status: RavenStatus
): { label: string; color: string; bg: string } {
  if (availability.kind === 'unavailable') {
    return {
      label: `voice: ${availability.reason}`,
      color: 'rgb(255, 105, 105)',
      bg: 'rgba(255,105,105,0.10)'
    }
  }
  switch (status) {
    case 'running':
      return {
        label: 'voice: listening',
        color: 'rgb(255, 175, 80)',
        bg: 'rgba(255,175,80,0.12)'
      }
    case 'starting':
    case 'stopping':
      return {
        label: 'voice: processing',
        color: 'rgb(100, 180, 255)',
        bg: 'rgba(100,180,255,0.10)'
      }
    case 'error':
      return {
        label: 'voice: error',
        color: 'rgb(255, 105, 105)',
        bg: 'rgba(255,105,105,0.10)'
      }
    case 'stopped':
    default:
      return {
        label: 'voice: ready',
        color: 'rgb(74, 224, 153)',
        bg: 'rgba(74,224,153,0.10)'
      }
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const minutes = Math.round(diff / 60_000)
  const hours = Math.round(minutes / 60)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return new Date(iso).toLocaleTimeString()
}

function TranscriptRow({ entry }: { entry: TranscriptEntry }): ReactElement {
  const isUser = entry.speaker === 'user'
  const speakerColor = isUser ? 'rgb(100, 180, 255)' : 'rgb(180, 130, 255)'
  return (
    <div
      className="holo-card rounded-xl border px-4 py-3"
      style={{
        background: 'rgba(15,15,25,0.5)',
        borderColor: 'var(--holo-border)'
      }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: speakerColor }}
        >
          {entry.speaker}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--holo-muted)' }}>
          {relativeTime(entry.timestamp)}
        </span>
      </div>
      <div className="text-sm leading-relaxed" style={{ color: 'var(--holo-text)' }}>
        {entry.text}
      </div>
    </div>
  )
}

function ToolCallRow({ entry }: { entry: ToolCallEntry }): ReactElement {
  const hasError = Boolean(entry.error)
  const statusColor = hasError
    ? 'rgb(255, 105, 105)'
    : entry.result
      ? 'rgb(74, 224, 153)'
      : 'rgb(255, 175, 80)'
  const statusLabel = hasError ? 'failed' : entry.result ? 'ok' : 'pending'
  return (
    <div
      className="holo-card rounded-xl border px-4 py-3 flex items-center justify-between gap-3"
      style={{
        background: 'rgba(15,15,25,0.5)',
        borderColor: 'var(--holo-border)'
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium px-2 py-0.5 rounded border shrink-0"
          style={{
            color: statusColor,
            borderColor: `${statusColor}55`,
            background: `${statusColor}10`
          }}
        >
          {statusLabel}
        </span>
        <span
          className="text-sm font-medium truncate"
          style={{ color: 'var(--holo-text)' }}
        >
          {entry.toolName}
        </span>
      </div>
      <span className="text-[11px] shrink-0" style={{ color: 'var(--holo-muted)' }}>
        {relativeTime(entry.timestamp)}
      </span>
    </div>
  )
}

function EmptyState({ message }: { message: string }): ReactElement {
  return (
    <div
      className="text-sm rounded-xl border border-dashed px-4 py-6 text-center"
      style={{
        color: 'var(--holo-muted)',
        borderColor: 'var(--holo-border)'
      }}
    >
      {message}
    </div>
  )
}

export function VoiceControl(): ReactElement {
  const [availability, setAvailability] = useState<VoiceAvailability>({
    kind: 'unavailable',
    reason: 'offline'
  })
  const [ravenState, setRavenState] = useState<RavenState>({ status: 'stopped' })
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([])
  const [toolCalls, setToolCalls] = useState<ToolCallEntry[]>([])
  const [pending, setPending] = useState(false)

  // Initial fetch + subscriptions. Subscriptions return unsubscribes which
  // we collect in the cleanup tuple.
  useEffect(() => {
    let cancelled = false

    void window.homeOS.voice.availability().then((a) => {
      if (!cancelled) setAvailability(a)
    })
    void window.homeOS.voice
      .status()
      .then((s) => {
        if (cancelled) return
        setRavenState({
          status: s.status,
          pid: s.pid,
          startedAt: s.startedAt,
          error: s.error
        })
      })
      .catch(() => {
        // Daemon not reachable yet — availability event will fix this.
      })
    void window.homeOS.voice.recentTranscripts(5).then(({ transcripts: t }) => {
      if (!cancelled) setTranscripts(t)
    })
    void window.homeOS.voice.recentToolCalls(5).then(({ toolCalls: tc }) => {
      if (!cancelled) setToolCalls(tc)
    })

    const unsubAvail = window.homeOS.voice.onAvailabilityChanged(setAvailability)
    const unsubStatus = window.homeOS.voice.onStatusChanged(setRavenState)
    const unsubTranscript = window.homeOS.voice.onTranscript((entry) => {
      setTranscripts((prev) => [...prev, entry].slice(-5))
    })
    const unsubToolCall = window.homeOS.voice.onToolCall((entry) => {
      setToolCalls((prev) => {
        // Update-in-place when a previously-pending call gets its result.
        const existing = prev.findIndex((e) => e.callId && e.callId === entry.callId)
        if (existing !== -1) {
          const next = prev.slice()
          next[existing] = entry
          return next
        }
        return [...prev, entry].slice(-5)
      })
    })

    return () => {
      cancelled = true
      unsubAvail()
      unsubStatus()
      unsubTranscript()
      unsubToolCall()
    }
  }, [])

  const onStart = useCallback(async () => {
    if (pending) return
    setPending(true)
    try {
      await window.homeOS.voice.start()
    } catch (e) {
      console.error('[voice-control] start failed', e)
    } finally {
      setPending(false)
    }
  }, [pending])

  const onStop = useCallback(async () => {
    if (pending) return
    setPending(true)
    try {
      await window.homeOS.voice.stop()
    } catch (e) {
      console.error('[voice-control] stop failed', e)
    } finally {
      setPending(false)
    }
  }, [pending])

  const pill = pillFor(availability, ravenState.status)
  const canStart = availability.kind === 'available' && ravenState.status === 'stopped'
  const canStop =
    availability.kind === 'available' &&
    (ravenState.status === 'running' || ravenState.status === 'starting')

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {availability.kind === 'available' ? (
              <Mic size={18} style={{ color: 'var(--holo-accent)' }} />
            ) : (
              <MicOff size={18} style={{ color: 'rgb(255, 105, 105)' }} />
            )}
            <span
              className="text-xs uppercase tracking-[0.18em] font-medium px-3 py-1 rounded border"
              style={{
                color: pill.color,
                borderColor: `${pill.color}55`,
                background: pill.bg
              }}
            >
              {pill.label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onStart}
              disabled={!canStart || pending}
              className="flex items-center gap-2 px-3 h-8 rounded-md text-xs transition-colors border"
              style={{
                color: canStart ? 'var(--holo-accent)' : 'var(--holo-muted)',
                borderColor: 'var(--holo-border)',
                background: canStart ? 'rgba(74,158,255,0.10)' : 'transparent',
                cursor: canStart && !pending ? 'pointer' : 'not-allowed',
                opacity: canStart && !pending ? 1 : 0.5
              }}
            >
              <Play size={12} />
              Start
            </button>
            <button
              type="button"
              onClick={onStop}
              disabled={!canStop || pending}
              className="flex items-center gap-2 px-3 h-8 rounded-md text-xs transition-colors border"
              style={{
                color: canStop ? 'rgb(255, 175, 80)' : 'var(--holo-muted)',
                borderColor: 'var(--holo-border)',
                background: canStop ? 'rgba(255,175,80,0.10)' : 'transparent',
                cursor: canStop && !pending ? 'pointer' : 'not-allowed',
                opacity: canStop && !pending ? 1 : 0.5
              }}
            >
              <Square size={12} />
              Stop
            </button>
          </div>
        </header>

        <section className="flex flex-col gap-3">
          <h2
            className="text-[11px] uppercase tracking-[0.22em]"
            style={{ color: 'var(--holo-muted)' }}
          >
            Recent transcripts
          </h2>
          {transcripts.length === 0 ? (
            <EmptyState message="No transcripts yet. Hit Start and say something." />
          ) : (
            <div className="flex flex-col gap-2">
              {transcripts
                .slice()
                .reverse()
                .map((t) => (
                  <TranscriptRow key={t.id} entry={t} />
                ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2
            className="text-[11px] uppercase tracking-[0.22em]"
            style={{ color: 'var(--holo-muted)' }}
          >
            Recent tool calls
          </h2>
          {toolCalls.length === 0 ? (
            <EmptyState message="No tool calls yet. Try: “what time is it?”" />
          ) : (
            <div className="flex flex-col gap-2">
              {toolCalls
                .slice()
                .reverse()
                .map((c) => (
                  <ToolCallRow key={c.id} entry={c} />
                ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
