/// <reference types="vite/client" />

import type { AetherApi } from '../../electron/preload'

declare global {
  interface Window {
    aether: AetherApi
  }
}

// Electron-specific CSS property for window-drag regions. Not in stock
// csstype, so React's CSSProperties doesn't know about it without this
// augmentation. Used by App.tsx to mark the top-nav strip as a drag
// surface (and individual buttons as no-drag).
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}

export {}
