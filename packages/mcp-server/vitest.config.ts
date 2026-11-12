import { defineConfig } from 'vitest/config';
import { sharedFromSource } from '../../vitest.shared-source.js';

export default defineConfig({
  ssr: sharedFromSource,
  test: {
    globals: true,
    environment: 'node',
    // The gate's drift check and parallel green runs load the PC; the temp-folder
    // tests (mirror scan, pump paging) then pass the 5 s default only on a quiet machine.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.test.*', '**/*.spec.*'],
    },
  },
});
