import { create } from 'zustand'

interface ActiveAppState {
  activeAppId: string
  setActiveAppId: (id: string) => void
}

// Default to 'welcome' — present from PR #5 onward. If the welcome app
// ever disappears, the App component falls back to the first discovered
// app in alphabetical order (see App.tsx).
export const useActiveApp = create<ActiveAppState>((set) => ({
  activeAppId: 'welcome',
  setActiveAppId: (id) => set({ activeAppId: id })
}))
