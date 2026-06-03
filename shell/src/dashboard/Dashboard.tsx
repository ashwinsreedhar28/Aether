import { useEffect, useState } from 'react'
import type { SceneEvent } from '../../electron/preload'
import { Cli } from './Cli'
import { PanelRenderer, type ScenePanel } from './PanelRenderer'

// A single delta change from the scene server (server/scene_doc.py
// `DeltaChange`). The preload types `changes` as `unknown[]`, so we narrow it
// here. The shape (confirmed by reading scene_doc.py during the read phase):
//   add:    { op: 'add',    panel: {...} }        (entity adds carry `entity`)
//   update: { op: 'update', panel: {...}, id }     (entity updates carry `entity`)
//   remove: { op: 'remove', id }                   (neither panel nor entity)
// Panel and entity changes ride the SAME `changes` array; consumers tell them
// apart by which field is populated. This lane reconciles PANELS ONLY.
interface DeltaChange {
  op?: 'add' | 'remove' | 'update'
  panel?: ScenePanel
  entity?: unknown
  id?: string
}

// Apply a delta's changes to the current panel list, returning a new list.
//
// Reconciliation is keyed by panel id and is entity-safe by construction:
//   - add / update: upsert `change.panel` by id (append if absent, replace if
//     present). Entity add/update carry `entity` instead of `panel`, so they
//     fall through the `!panel` guard and are skipped — exactly what we want
//     (entity rendering is a later concern).
//   - remove: drop the panel whose id matches `change.id`. A remove carries
//     only an id with neither panel nor entity, so we can't tell a panel-remove
//     from an entity-remove — but filtering the panel list by id is harmless
//     when the id belongs to an entity (it simply matches nothing).
// This is the SAFE interpretation per the lane spec; no refetch fallback is
// needed because every op is unambiguously applicable to the panel list.
function reconcile(prev: ScenePanel[], changes: unknown[]): ScenePanel[] {
  let next = prev
  for (const raw of changes) {
    const change = raw as DeltaChange
    switch (change.op) {
      case 'add':
      case 'update': {
        const panel = change.panel
        if (!panel || typeof panel.id !== 'string') break // entity / malformed — skip
        const idx = next.findIndex((p) => p.id === panel.id)
        if (idx === -1) {
          next = [...next, panel]
        } else {
          next = next.slice()
          next[idx] = panel
        }
        break
      }
      case 'remove': {
        if (typeof change.id !== 'string') break
        next = next.filter((p) => p.id !== change.id)
        break
      }
      default:
        // Unknown op — skip rather than corrupt state.
        break
    }
  }
  return next
}

// Ambient-listening indicator for the top strip. Display-only (no interactive
// children, so it stays inside the strip's drag region without a no-drag
// override). Listening state is derived purely from the daemon status field:
// 'running'/'starting' = mic is hot, anything else = off. When the shell is
// launched with AETHER_VOICE_AMBIENT=0 nothing ever starts the session, so the
// status stays 'stopped' and this naturally reads "voice off" — the indicator
// needs no knowledge of the env flag itself.
function VoiceIndicator(): React.ReactElement {
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

// The live scene dashboard. Subscribes to the main-process scene subscriber
// (window.aether.scene.onSceneEvent), maintains the panel list in React state,
// and renders panels as an arrival-order column of cards with the CLI strip
// pinned at the bottom.
export function Dashboard(): React.ReactElement {
  const [panels, setPanels] = useState<ScenePanel[]>([])

  // Signal renderer-ready after the first commit. The main process's
  // splash → reveal sequence waits on this. Moved here from the deleted
  // PlaceholderDashboard (Sprint 6.3b).
  useEffect(() => {
    window.aether.signalReady()
  }, [])

  // Subscribe to scene events: a snapshot on connect replaces the whole list;
  // subsequent deltas are reconciled incrementally by id.
  useEffect(() => {
    const unsubscribe = window.aether.scene.onSceneEvent((ev: SceneEvent) => {
      if (ev.type === 'snapshot') {
        setPanels(ev.scene.panels as ScenePanel[])
      } else {
        setPanels((prev) => reconcile(prev, ev.changes))
      }
    })
    return unsubscribe
  }, [])

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden select-none"
      style={{ background: 'var(--holo-bg)', color: 'var(--holo-text)' }}
    >
      {/* Draggable top strip. Reserves vertical space so the first panel card
          never sits under the macOS traffic lights (titleBarStyle:
          'hiddenInset', frame: false). The label is centered so it clears the
          top-left traffic lights on macOS without a platform branch; the whole
          strip is a drag region (no interactive children → no no-drag needed).
          The voice indicator is absolutely positioned at the right edge (clear
          of the top-left traffic lights) so it doesn't disturb the centering. */}
      <div
        className="relative shrink-0 h-9 flex items-center justify-center text-[10px] tracking-[0.3em]"
        style={{ color: 'var(--holo-muted)', WebkitAppRegion: 'drag' }}
      >
        AETHER · SCENE
        <VoiceIndicator />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        {panels.length === 0 ? (
          <div
            className="h-full flex items-center justify-center text-xs tracking-widest"
            style={{ color: 'var(--holo-muted)' }}
          >
            NO PANELS — WAITING FOR SCENE
          </div>
        ) : (
          panels.map((panel) => (
            <div
              key={panel.id}
              className="rounded border p-3"
              style={{ borderColor: 'var(--holo-border)', background: 'var(--holo-panel)' }}
            >
              <div
                className="text-[10px] font-mono mb-2 truncate"
                style={{ color: 'var(--holo-muted)' }}
                title={panel.id}
              >
                {panel.id}
                {panel.kind && panel.kind !== 'text' ? ` · ${panel.kind}` : ''}
              </div>
              <PanelRenderer panel={panel} />
            </div>
          ))
        )}
      </div>

      <Cli />
    </div>
  )
}
