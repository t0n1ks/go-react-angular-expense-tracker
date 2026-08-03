import { defineConfig } from 'vitest/config'

// Standalone Vitest config (kept separate from vite.config.ts so the app's
// `tsc -b` build never typechecks it).
//
// Still no jsdom: the .ts unit tests are pure logic, and the one component
// test renders through react-dom/server, which needs no DOM. esbuild picks up
// `"jsx": "react-jsx"` from tsconfig, so .tsx needs no React plugin either —
// the fast node environment runs both.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
