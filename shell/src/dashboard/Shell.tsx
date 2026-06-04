import { useEffect, useState } from 'react'
import { Cli } from './Cli'
import { ChatsView } from './ChatsView'
import { LanesView } from './LanesView'
import { MeshView } from './MeshView'
import { SceneView } from './SceneView'
import { VoiceIndicator } from './VoiceIndicator'

// The instrument views of the cockpit. Scene is the ambient default home (the
// panel dashboard); the others add navigable depth. These are INSTRUMENT VIEWS,
// not content apps — they render the state of Aether, they are not destinations
// you "open". The CLI is a GLOBAL channel, not a view, so it lives below.
type View = 'scene' | 'chats' | 'mesh' | 'lanes'

const TABS: { id: View; label: string }[] = [
  { id: 'scene', label: 'SCENE' },
  { id: 'chats', label: 'CHATS' },
  { id: 'mesh', label: 'MESH' },
  { id: 'lanes', label: 'LANES' },
]

// TABS is the single source of truth for the navigable view set. The
// navigate voice tool (raven-core) returns a validated view name; we
// re-validate it here before switching so a daemon/renderer drift fails
// safe (an unknown view is ignored, never switched to).
function isView(v: unknown): v is View {
  return typeof v === 'string' && TABS.some((tab) => tab.id === v)
}

// The shell: a draggable top bar (brand · tabs · voice indicator), the active
// view, and the always-present CLI bar. Owns view-switch state and the
// renderer-ready signal.
export function Shell(): React.ReactElement {
  const [view, setView] = useState<View>('scene')
  // macOS frames the window with hiddenInset traffic lights at top-left (~80px);
  // the tab row must clear them. Windows custom controls sit top-RIGHT, leaving
  // the left free. Guess synchronously from navigator to avoid a layout flash,
  // then confirm against the authoritative platform from main.
  const [isMac, setIsMac] = useState(() => navigator.platform.toLowerCase().includes('mac'))

  // Signal renderer-ready after the first commit. The main process's
  // splash → reveal sequence waits on this. Fires once, view-independent.
  useEffect(() => {
    window.aether.signalReady()
  }, [])

  useEffect(() => {
    void window.aether
      .getMetadata()
      .then((m) => setIsMac(m.platform === 'darwin'))
      .catch(() => {
        /* keep the navigator guess */
      })
  }, [])

  // Voice/typed navigation. The navigate tool makes no mesh call — it
  // validates a view name and returns { ok, view }. Every tool call is
  // pushed to the renderer over voice:tool-call (the same channel
  // visualize rides), so navigation needs zero new transport: we pick
  // navigate calls out of the stream and flip the view. The push fires
  // twice per call (once on dispatch with no result, once on completion
  // with it); keying on the tool's VALIDATED result.view rather than the
  // raw args means the first (result-less) push is skipped and only a
  // successful switch acts.
  useEffect(() => {
    return window.aether.voice.onToolCall((entry) => {
      if (entry.toolName !== 'navigate') return
      const next = entry.result?.view
      if (isView(next)) setView(next)
    })
  }, [])

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden select-none"
      style={{ background: 'var(--holo-bg)', color: 'var(--holo-text)' }}
    >
      {/* Draggable top strip. Reserves vertical space so content never sits under
          the macOS traffic lights. The strip itself is a drag region; the tab
          buttons opt out with no-drag so they stay clickable. The brand label
          and empty space remain draggable. The voice indicator is absolutely
          positioned at the right edge so it doesn't disturb the tab row. */}
      <div
        className="relative shrink-0 h-9 flex items-center"
        style={{ WebkitAppRegion: 'drag' }}
      >
        <div
          className="flex items-center gap-3"
          style={{ paddingLeft: isMac ? 80 : 12 }}
        >
          <span className="text-[10px] tracking-[0.3em]" style={{ color: 'var(--holo-muted)' }}>
            AETHER ·
          </span>
          <nav className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' }}>
            {TABS.map((tab) => {
              const active = tab.id === view
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setView(tab.id)}
                  className="text-[10px] tracking-[0.3em]"
                  style={{
                    color: active ? 'var(--holo-text)' : 'var(--holo-muted)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textShadow: active ? '0 0 8px var(--holo-glow)' : 'none',
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>
        <VoiceIndicator />
      </div>

      {/* View area. SceneView stays MOUNTED (only hidden) so its scene
          subscription and accumulated panels survive view switches — a panel
          summoned while on another view is already there on return. The other
          views mount only while active, so e.g. LanesView's poll loop stops the
          moment you leave it. */}
      <div className="flex-1 min-h-0 relative">
        <div className={view === 'scene' ? 'h-full' : 'hidden'}>
          <SceneView />
        </div>
        {view === 'chats' && <ChatsView />}
        {view === 'mesh' && <MeshView />}
        {view === 'lanes' && <LanesView />}
      </div>

      {/* Global CLI — the type-to-Aether channel, present in every view. On
          Chats the echo log is hidden (the chat view IS the transcript); the
          input stays so you can still type to Aether from there. */}
      <Cli showEcho={view !== 'chats'} />
    </div>
  )
}
