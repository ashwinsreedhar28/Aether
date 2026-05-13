/// <reference types="vite/client" />

import type { HomeOSApi } from '../../electron/preload'

declare global {
  interface Window {
    homeOS: HomeOSApi
  }
}

export {}
