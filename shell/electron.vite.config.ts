import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

// electron-vite builds three targets — main / preload / renderer — out of one
// project. Layout mirrors VIEWER (`apps/viewer/electron/...`) and Pulse
// (`src/main/...`). Renderer root sits under `src/` so future apps under
// `src/apps/` (per CLAUDE.md §4) auto-resolve relative to the renderer root.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        // Two preload entries — `index` is the main window's window.aether
        // surface; `splashPreload` is a tiny script that only exposes
        // window.aetherSplash so the boot-phase status line can update.
        // electron-vite emits each input as `<key>.js` under outDir, which
        // is what main/index.ts loads via SPLASH_PRELOAD_PATH.
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts'),
          splashPreload: resolve(__dirname, 'electron/preload/splashPreload.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': resolve(__dirname, 'src') }
    },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/index.html') }
      }
    }
  }
})
