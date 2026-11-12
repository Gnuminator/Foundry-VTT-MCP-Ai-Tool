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
    include: [
      'packages/mcp-server/src/guarded-write/**/*.test.ts',
      'packages/foundry-module/src/data-access/guarded-write*.test.ts',
    ],
  },
});
