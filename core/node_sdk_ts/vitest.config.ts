import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The round-trip test spawns Python and polls /v0/healthz; give it
    // plenty of headroom on cold machines.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
})
