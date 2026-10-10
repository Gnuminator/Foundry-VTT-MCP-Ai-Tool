import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // web/src: the React components' tests, rendered to a string (no DOM, no new framework).
    include: ['src/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
});
