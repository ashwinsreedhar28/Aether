import { useEffect, useState } from 'react'

// Ambient-listening indicator for the top strip. Display-only (no interactive
// children, so it stays inside the strip's drag region without a no-drag
// override). Listening state is derived purely from the daemon status field:
// 'running'/'starting' = mic is hot, anything else = off. When the shell is
// launched with AETHER_VOICE_AMBIENT=0 nothing ever starts the session, so the
// status stays 'stopped' and this naturally reads "voice off" — the indicator
// needs no knowledge of the env flag itself.
//
// Lives in the global top bar (rendered by Shell), so it is visible in every
// view — Scene, Chats, Mesh, Lanes — not just the scene dashboard.
export function VoiceIndicator(): React.ReactElement {
  const [listening, setListening] = useState(false)

  useEffect(() => {
    let active = true
    const isLive = (status: string): boolean =>
      status === 'running' || status === 'starting'

    // Seed from the current status, then track pushed transitions.
    window.aether.voice
      .status()
      .then((s) => {
        if (active) setListening(isLive(s.status))
      })
      .catch(() => {
        /* daemon unreachable → leave off */
      })
    const unsubscribe = window.aether.voice.onStatusChanged((s) => {
      setListening(isLive(s.status))
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return (
    <div
      className="absolute right-3 flex items-center gap-1.5 text-[10px] tracking-[0.2em]"
      style={{ color: 'var(--holo-muted)' }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: listening ? 'var(--holo-accent)' : 'var(--holo-muted)',
          boxShadow: listening ? '0 0 6px var(--holo-glow)' : 'none',
        }}
      />
      {listening ? 'LISTENING' : 'VOICE OFF'}
    </div>
  )
}
