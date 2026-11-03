// Preact spike: the dashboard build, Storybook and the browser tests (which run the build) resolve
// `react` and `react-dom` to `preact/compat`. The source still imports from 'react' and keeps the
// React types; only what ships changes. Exact-match patterns, so `react-dom/server` in the unit
// tests (vitest, not this config) and package names that merely start with "react" are untouched.
import type { Alias } from 'vite';

export const PREACT_ALIASES: Alias[] = [
  { find: /^react$/, replacement: 'preact/compat' },
  { find: /^react-dom$/, replacement: 'preact/compat' },
  { find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
  { find: /^react-dom\/server$/, replacement: 'preact/compat/server' },
  { find: /^react\/jsx-runtime$/, replacement: 'preact/compat/jsx-runtime' },
  { find: /^react\/jsx-dev-runtime$/, replacement: 'preact/compat/jsx-dev-runtime' },
];
