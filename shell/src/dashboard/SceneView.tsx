import { useEffect, useReducer, useRef } from 'react'
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

// A panel id is "summon-driven" (worth a re-summon affordance) unless it's a
// dashboard.* backdrop. Backdrops (dashboard.mesh-health / .raven-status /
// .lanes) are re-POSTed in place on the visualizer's ~10s poll loop, so they
// produce a steady stream of update deltas that are NOT user-summoned — pulsing
// on every poll would be noise. Everything else (the viz-* overlays summoned by
// voice/CLI) is summon-driven. The payload carries no explicit summon/poll flag
// (style.source names the posting node, not the trigger), so the id prefix is
// the cleanest available discriminator — and a complete one: every backdrop id
// is dashboard.*, every summoned overlay is not.
function isSummonDriven(id: string): boolean {
  return !id.startsWith('dashboard.')
}

// Apply a delta's changes to the current panel list, returning the new list plus
// the ids of panels that were *refreshed in place* by a summon (an update that
// landed on an already-rendered, non-dashboard panel — i.e. a re-summon). The
// caller uses `resummoned` to fire the attention affordance; a brand-new panel
// (append) is NOT in it, so new panels keep their plain entry behavior.
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
function reconcile(
  prev: ScenePanel[],
  changes: unknown[],
): { next: ScenePanel[]; resummoned: string[] } {
  let next = prev
  const resummoned: string[] = []
  for (const raw of changes) {
    const change = raw as DeltaChange
    switch (change.op) {
      case 'add':
      case 'update': {
        const panel = change.panel
        if (!panel || typeof panel.id !== 'string') break // entity / malformed — skip
        const idx = next.findIndex((p) => p.id === panel.id)
        if (idx === -1) {
          next = [...next, panel] // brand-new panel — plain entry, no affordance
        } else {
          next = next.slice()
          next[idx] = panel
          // Already on screen + refreshed = a re-summon. Skip dashboard.*
          // backdrops, whose poll-loop re-POSTs also land here.
          if (isSummonDriven(panel.id)) resummoned.push(panel.id)
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
  return { next, resummoned }
}

// Scene state: the panel list plus a per-id "pulse nonce" that increments each
// time a panel is re-summoned. PanelCard watches its nonce to fire the
// affordance. Kept in one reducer so the panel update and the nonce bump are a
// single pure transition (no setState-inside-setState, no stale closures).
interface SceneState {
  panels: ScenePanel[]
  pulses: Record<string, number>
}
type SceneAction =
  | { kind: 'snapshot'; panels: ScenePanel[] }
  | { kind: 'delta'; changes: unknown[] }

function sceneReducer(state: SceneState, action: SceneAction): SceneState {
  switch (action.kind) {
    case 'snapshot':
      // A snapshot replaces the whole list (initial connect / reconnect). Keep
      // pulses untouched: surviving cards keep their nonce so they don't see a
      // spurious change, and ids new to the snapshot simply have no entry (0).
      return { panels: action.panels, pulses: state.pulses }
    case 'delta': {
      const { next, resummoned } = reconcile(state.panels, action.changes)
      if (resummoned.length === 0) return { ...state, panels: next }
      const pulses = { ...state.pulses }
      for (const id of resummoned) pulses[id] = (pulses[id] ?? 0) + 1
      return { panels: next, pulses }
    }
  }
}

// One Scene card. Keeps a ref to its root so it can fire the re-summon
// affordance imperatively. Brand-new cards mount with pulseNonce 0 and the
// effect's guard makes that first run a no-op; each later re-summon bumps the
// nonce, re-running the effect.
function PanelCard({
  panel,
  pulseNonce,
}: {
  panel: ScenePanel
  pulseNonce: number
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pulseNonce === 0) return // initial render — never an affordance
    const el = ref.current
    if (!el) return
    // Scroll only if off-screen: block:'nearest' is a no-op when the card is
    // already fully visible in the Scene scroll container, and aligns it to the
    // nearest edge otherwise — exactly "scroll-into-view if outside viewport".
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    // Re-trigger the CSS animation: remove → force reflow → re-add, so a rapid
    // second re-summon restarts the pulse instead of being a no-op.
    el.classList.remove('resummon-pulse')
    void el.offsetWidth
    el.classList.add('resummon-pulse')
  }, [pulseNonce])

  return (
    <div
      ref={ref}
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
  )
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
  const [state, dispatch] = useReducer(sceneReducer, { panels: [], pulses: {} })
  const { panels, pulses } = state

  // Subscribe to scene events: a snapshot on connect replaces the whole list;
  // subsequent deltas are reconciled incrementally by id (and a re-summon of an
  // already-rendered panel bumps that panel's pulse nonce).
  useEffect(() => {
    const unsubscribe = window.aether.scene.onSceneEvent((ev: SceneEvent) => {
      if (ev.type === 'snapshot') {
        dispatch({ kind: 'snapshot', panels: ev.scene.panels as ScenePanel[] })
      } else {
        dispatch({ kind: 'delta', changes: ev.changes })
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
          <PanelCard key={panel.id} panel={panel} pulseNonce={pulses[panel.id] ?? 0} />
        ))
      )}
    </div>
  )
}
