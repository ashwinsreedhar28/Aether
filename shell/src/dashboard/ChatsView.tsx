import { useEffect, useMemo, useRef, useState } from 'react'
import type { TranscriptEntry } from '../../electron/preload'

// Chats — the persistent conversation surface, Claude-web style: a sidebar of
// past sessions (newest first, the current one badged LIVE) and a detail pane
// showing the selected session's conversation. On mount it pulls durable
// history from the daemon (voice.getTranscripts, seeded from disk so prior
// sessions survive a restart) and subscribes to the live transcript push
// (voice.onTranscript — the same channel the CLI echo rides). Turns render as
// aligned chat bubbles (you / aether) in the CLI's monospace aesthetic; the view
// defaults to the live session and live-appends there. §15 restraint: no extra
// deps, sidebar/detail idiom borrowed from LanesView.

// How many entries to pull on mount. The daemon ring caps at 200; asking for
// that many gives "recent history" without paging machinery (a later lane).
const HISTORY_LIMIT = 200

// A merged conversational turn: consecutive same-speaker fragments concatenated
// (transcription arrives incrementally, exactly as the CLI merges its echo).
type Bubble = { kind: 'bubble'; id: string; speaker: 'user' | 'raven'; text: string }
// A 'system' line (greetings / status) — rendered as a centered note, not a
// bubble, and it never merges into an adjacent turn.
type Note = { kind: 'note'; id: string; text: string }
type Item = Bubble | Note

type SessionGroup = {
  sessionId: string
  startTs: string
  lastTs: string
  preview: string
  items: Item[]
}

const SPEAKER_LABEL: Record<'user' | 'raven', string> = {
  user: 'you',
  raven: 'aether',
}

// Full date + time for the detail-pane heading.
function formatHeading(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${date} · ${time}`
}

// Compact date + time for the sidebar row (two same-day sessions stay distinct).
function formatSidebar(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${date} · ${time}`
}

// Fold the flat, chronological entry list into session groups of merged turns.
// Pure over `entries` (memoized) — never mutates state. Groups come out in
// chronological order (oldest first); the sidebar re-sorts a copy newest-first.
function groupEntries(entries: TranscriptEntry[]): SessionGroup[] {
  const groups: SessionGroup[] = []
  let group: SessionGroup | null = null
  let bubble: Bubble | null = null

  for (const e of entries) {
    if (e.text === '') continue
    if (!group || group.sessionId !== e.sessionId) {
      group = { sessionId: e.sessionId, startTs: e.timestamp, lastTs: e.timestamp, preview: '', items: [] }
      groups.push(group)
      bubble = null
    }
    group.lastTs = e.timestamp
    group.preview = e.text
    if (e.speaker === 'system') {
      group.items.push({ kind: 'note', id: e.id, text: e.text })
      bubble = null
      continue
    }
    const speaker = e.speaker // 'user' | 'raven' (system handled above)
    if (bubble && bubble.speaker === speaker) {
      bubble.text += e.text
      group.preview = bubble.text
    } else {
      bubble = { kind: 'bubble', id: e.id, speaker, text: e.text }
      group.items.push(bubble)
    }
  }
  return groups
}

function Dot({ live }: { live: boolean }): React.ReactElement {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        flexShrink: 0,
        background: live ? 'var(--holo-accent)' : 'var(--holo-muted)',
        boxShadow: live ? '0 0 6px var(--holo-glow)' : 'none',
      }}
    />
  )
}

function LiveBadge(): React.ReactElement {
  return (
    <span
      className="text-[9px] tracking-[0.2em] px-1.5 py-0.5 rounded"
      style={{ color: 'var(--holo-accent)', border: '1px solid var(--holo-border)' }}
    >
      LIVE
    </span>
  )
}

function ChatBubble({ bubble }: { bubble: Bubble }): React.ReactElement {
  const isUser = bubble.speaker === 'user'
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <span
        className="text-[9px] tracking-[0.25em] uppercase mb-1 px-1"
        style={{ color: isUser ? 'var(--holo-muted)' : 'var(--holo-accent)' }}
      >
        {SPEAKER_LABEL[bubble.speaker]}
      </span>
      <div
        className="max-w-[78%] rounded-lg px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words"
        style={{
          color: 'var(--holo-text)',
          background: isUser ? 'var(--holo-panel)' : 'rgba(var(--holo-accent-rgb), 0.08)',
          border: '1px solid var(--holo-border)',
        }}
      >
        {bubble.text}
      </div>
    </div>
  )
}

function ConversationPane({
  group,
  live,
}: {
  group: SessionGroup
  live: boolean
}): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  // Pin to bottom unless the user has scrolled up to read earlier turns.
  const pinnedRef = useRef(true)

  // On session switch: jump to the latest turn and re-pin.
  useEffect(() => {
    pinnedRef.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [group.sessionId])

  // On new turns in the shown session: follow to the bottom when pinned.
  useEffect(() => {
    const el = scrollRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [group.items.length])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  return (
    <div className="h-full flex flex-col min-w-0">
      <div className="shrink-0 flex items-center gap-2 px-5 py-3 border-b" style={{ borderColor: 'var(--holo-border)' }}>
        <Dot live={live} />
        <span className="text-sm font-mono" style={{ color: 'var(--holo-text)' }}>
          {formatHeading(group.startTs)}
        </span>
        {live && <LiveBadge />}
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-3">
        {group.items.map((item) =>
          item.kind === 'note' ? (
            <div
              key={item.id}
              className="text-center text-[10px] font-mono tracking-wide whitespace-pre-wrap break-words"
              style={{ color: 'var(--holo-muted)', opacity: 0.7 }}
            >
              {item.text}
            </div>
          ) : (
            <ChatBubble key={item.id} bubble={item} />
          ),
        )}
      </div>
    </div>
  )
}

export function ChatsView(): React.ReactElement {
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  // The session id of the currently-live spawn. Learned two ways: an exact
  // /status read on mount (voice.status().sessionId — present only while a child
  // is actually listening, so a reboot's prior session is never mislabeled LIVE),
  // and live transcript pushes as a fallback if /status is unreachable or the
  // session begins after mount. Never set from loaded history.
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null)
  // Sticky once the user clicks a session, so a background live append never
  // yanks them off the conversation they chose to read.
  const manualRef = useRef(false)

  // Subscribe first, then fetch — so an entry arriving during the fetch isn't
  // missed. The union-by-id merge keeps both paths consistent: the fetch result
  // (chronological, from the ring) leads, and any live entries that landed
  // before it resolved are appended after, never duplicated.
  useEffect(() => {
    const unsubscribe = window.aether.voice.onTranscript((entry) => {
      setLiveSessionId(entry.sessionId)
      setEntries((prev) => (prev.some((e) => e.id === entry.id) ? prev : [...prev, entry]))
    })
    // Exact-on-mount LIVE badging: ask the daemon which session is live right
    // now so the badge appears immediately — before this session's first turn,
    // and even when the user opens Chats mid-session (the push fired before we
    // subscribed). Only sets when a session is actually live (sessionId present),
    // so it never clears a value the push fallback already learned.
    void window.aether.voice
      .status()
      .then((s) => {
        if (s.sessionId) setLiveSessionId(s.sessionId)
      })
      .catch(() => {
        /* daemon unreachable — first-push detection remains the fallback */
      })
    void window.aether.voice
      .getTranscripts({ limit: HISTORY_LIMIT })
      .then(({ transcripts }) => {
        setEntries((prev) => {
          const ids = new Set(transcripts.map((e) => e.id))
          const live = prev.filter((e) => !ids.has(e.id))
          return [...transcripts, ...live]
        })
      })
      .catch(() => {
        /* daemon unreachable — stay on the empty state */
      })
      .finally(() => setLoading(false))
    return unsubscribe
  }, [])

  // Sessions newest-first for the sidebar.
  const sessions = useMemo(() => {
    const groups = groupEntries(entries)
    return [...groups].sort((a, b) => b.startTs.localeCompare(a.startTs))
  }, [entries])

  // Selection: auto-follow the live session unless the user has picked one;
  // otherwise keep a valid selection, defaulting to the newest session.
  useEffect(() => {
    if (sessions.length === 0) {
      if (selected !== null) setSelected(null)
      return
    }
    const ids = sessions.map((s) => s.sessionId)
    const livePresent = liveSessionId !== null && ids.includes(liveSessionId)
    if (livePresent && !manualRef.current && selected !== liveSessionId) {
      setSelected(liveSessionId)
      return
    }
    if (selected === null || !ids.includes(selected)) {
      setSelected(livePresent ? liveSessionId : (sessions[0] as SessionGroup).sessionId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, liveSessionId])

  const selectedGroup = sessions.find((s) => s.sessionId === selected) ?? null

  const pick = (sessionId: string): void => {
    manualRef.current = true
    setSelected(sessionId)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 py-2 text-xs tracking-[0.3em]" style={{ color: 'var(--holo-muted)' }}>
        CHATS
      </div>

      {loading && sessions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[11px] tracking-widest" style={{ color: 'var(--holo-muted)' }}>
          loading conversations…
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 select-none">
          <div className="text-[11px] tracking-widest" style={{ color: 'var(--holo-muted)' }}>
            NO CONVERSATIONS YET
          </div>
          <div className="text-[10px] tracking-wider" style={{ color: 'var(--holo-muted)', opacity: 0.6 }}>
            speak or type to Aether — turns land here
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex">
          {/* Sidebar: one row per session, newest first. */}
          <div className="w-56 shrink-0 overflow-y-auto border-r" style={{ borderColor: 'var(--holo-border)' }}>
            {sessions.map((s) => {
              const isSel = s.sessionId === selected
              const isLive = s.sessionId === liveSessionId
              return (
                <button
                  key={s.sessionId}
                  type="button"
                  onClick={() => pick(s.sessionId)}
                  className="w-full text-left px-3 py-2 flex flex-col gap-1"
                  style={{
                    background: isSel ? 'var(--holo-panel)' : 'transparent',
                    borderLeft: isSel ? '2px solid var(--holo-accent)' : '2px solid transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Dot live={isLive} />
                    <span className="text-xs font-mono truncate" style={{ color: 'var(--holo-text)' }}>
                      {formatSidebar(s.startTs)}
                    </span>
                    {isLive && <span className="ml-auto"><LiveBadge /></span>}
                  </div>
                  <span className="text-[10px] font-mono truncate pl-3" style={{ color: 'var(--holo-muted)' }} title={s.preview}>
                    {s.preview || '—'}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Detail pane: the selected session's conversation. */}
          <div className="flex-1 min-w-0">
            {selectedGroup ? (
              <ConversationPane group={selectedGroup} live={selectedGroup.sessionId === liveSessionId} />
            ) : (
              <div className="h-full flex items-center justify-center text-[11px] tracking-widest" style={{ color: 'var(--holo-muted)' }}>
                SELECT A CONVERSATION
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
