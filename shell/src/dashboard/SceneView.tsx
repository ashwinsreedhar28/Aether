import { useEffect, useState } from 'react'
import type { SceneEvent } from '../../electron/preload'
import { PanelRenderer, type ScenePanel } from './PanelRenderer'

// A single delta change from the scene server (server/scene_doc.py
// `DeltaChange`). The preload types `changes` as `unknown[]`, so we narrow it
// here. The shape (confirmed by reading scene_doc.py during the read phase):
//   add:    { op: 'add',    panel: {...} }        (entity adds carry `entity`)
//   update: { op: 'update', panel: {...}, id }     (entity updates carry `entity`)
//   remove: { op: 'remove', id }                   (neither panel nor entity)
// Panel and entity changes ride the SAME `changes` array; consumers tell them
// apart by which field is populated. This view reconciles PANELS ONLY.
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

// The ambient Scene: the live panel dashboard, and Aether's default home view.
// Subscribes to the main-process scene subscriber (window.aether.scene
// .onSceneEvent), maintains the panel list in React state, and renders panels
// as an arrival-order column of cards.
//
// Shell keeps this view MOUNTED across view switches (it only hides it), so the
// scene subscription never tears down. That matters: a panel summoned (via voice
// or CLI) while the user is looking at another view arrives as a delta and is
// reconciled live — switching back to Scene shows it already present. A snapshot
// arrives once on the main-process WS connect; unmounting here would lose the
// accumulated panel state with no snapshot replay to rebuild it.
export function SceneView(): React.ReactElement {
  const [panels, setPanels] = useState<ScenePanel[]>([])

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
    <div className="h-full overflow-y-auto px-4 pt-1 pb-4 space-y-3">
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
  )
}
