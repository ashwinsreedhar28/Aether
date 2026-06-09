import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    // @viewer/core is an ESM-only package (its exports expose only an `import`
    // condition). The main bundle is CJS on Electron 33 / Node 20, which can
    // neither match a non-existent `require` condition nor require() ESM — so
    // we bundle it in instead of externalizing. Its heavy deps (react, mermaid,
    // katex, …) are also direct deps here, so they stay external and resolve
    // from node_modules at runtime.
    plugins: [externalizeDepsPlugin({ exclude: ['@viewer/core'] })],
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: '.',
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
        },
      },
    },
    plugins: [react()],
    optimizeDeps: {
      include: ['mermaid'],
    },
  },
});
