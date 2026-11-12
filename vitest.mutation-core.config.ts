import { defineConfig } from 'vitest/config';
import { sharedFromSource } from './vitest.shared-source.js';

/**
 * The tests Stryker runs for `npm run mutation:core` (see `stryker.core.config.mjs`): the
 * guarded-write tests of the MCP server and of the Foundry module, with `@gnuminator/shared`
 * read from source so a mutant in `shared/src` is seen without a build.
 */
export default defineConfig({
  ssr: sharedFromSource,
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The whole suites of the three packages, as in the 2026-11-11 measurement: a line only a tool
    // test runs is covered. Three files cannot pass inside Stryker (they need a built dist, count
    // port literals across the repo, or scan module source text the instrumenting changes).
    include: [
      'shared/src/**/*.test.ts',
      'packages/mcp-server/src/**/*.test.ts',
      'packages/foundry-module/src/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/mcp-modern-probe.test.ts',
      'shared/src/ports.test.ts',
      '**/wait-for-event.test.ts',
    ],
  },
});
