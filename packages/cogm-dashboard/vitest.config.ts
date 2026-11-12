import { defineConfig } from 'vitest/config';
import { sharedFromSource } from '../../vitest.shared-source.js';

export default defineConfig({
  ssr: sharedFromSource,
  test: {
    globals: true,
    environment: 'node',
    // web/src: the React components' tests, rendered to a string (no DOM, no new framework).
    include: ['src/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
});
