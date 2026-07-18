import { defineConfig } from 'vitest/config'

// Standalone Vitest config (kept separate from vite.config.ts so the app's
// `tsc -b` build never typechecks it). The unit tests are pure TypeScript with
// no JSX/DOM, so no React plugin or jsdom environment is needed — esbuild
// transforms the .ts files and the fast node environment runs them.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
