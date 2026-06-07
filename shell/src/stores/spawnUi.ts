import { create } from 'zustand'

// Shared UI state for the spawn actor's window — separate from the ledger
// SNAPSHOT (which is lifecycle truth). This holds only "what is the Director
// looking at," so the global approval card (SpawnApproval) and the Spawns strip
// (inside LanesView, a different part of the tree) can agree on it.
//
// Why a store: minimize must hide the card WITHOUT a lifecycle change (Mark
// complete is no longer the only way to dismiss the window), and the strip is
// the reopen affordance — clicking a chip must re-raise that spawn's card. Those
// two components don't share a parent, so the open/minimize intent lives here.
//
// `minimizedKey` is `${id}:${status}`, not just an id: a status transition
// (requested → spawned, say) produces a new key, so a card minimized in one
// state re-raises when it advances — the Director still sees the spawn land.
interface SpawnUiState {
  // The record id the Director explicitly reopened from the strip. Overrides a
  // minimize; null when there is no manual override.
  openedId: string | null
  // Identity (`${id}:${status}`) of the card the Director minimized. The modal
  // stays hidden while the focused card matches this; null when nothing is hidden.
  minimizedKey: string | null
  // Strip click: reopen this spawn's card (and clear any minimize so it shows).
  open: (id: string) => void
  // Minimize the current card without touching lifecycle state.
  minimize: (key: string) => void
}

export const useSpawnUi = create<SpawnUiState>((set) => ({
  openedId: null,
  minimizedKey: null,
  open: (id) => set({ openedId: id, minimizedKey: null }),
  minimize: (key) => set({ minimizedKey: key, openedId: null }),
}))
