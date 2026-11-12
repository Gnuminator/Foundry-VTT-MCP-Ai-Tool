import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * The one Vitest base config. Every `vitest.config.ts` (each package and `shared`) extends it with
 * `mergeConfig(sharedConfig, defineConfig({...}))`; `shared-source.test.ts` in `packages/mcp-server/src`
 * fails if one does not.
 *
 * It makes `@gnuminator/shared` resolve to `shared/src` in tests (the `development` condition in
 * `shared/package.json` exports), so a fresh worktree tests without building `shared` first.
 * Vitest's node environment reads `ssr.resolve.conditions`, not `resolve.conditions`, and the
 * defaults must be kept (a custom list replaces them). Release builds do not set the condition and
 * read `shared/dist`.
 */
export const sharedConfig = defineConfig({
  ssr: {
    resolve: { conditions: ['development', ...defaultServerConditions] },
  },
  test: {
    environment: 'node',
  },
});
