import { defaultServerConditions } from 'vite';

/**
 * Makes `@gnuminator/shared` resolve to `shared/src` in tests (the `development` condition in
 * `shared/package.json` exports), so a fresh worktree tests without building `shared` first.
 * Vitest's node environment reads `ssr.resolve.conditions`, not `resolve.conditions`, and the
 * defaults must be kept (a custom list replaces them). Release builds do not set the condition and
 * read `shared/dist`. `shared-source.test.ts` in `packages/mcp-server/src` asserts the resolved path.
 */
export const sharedFromSource = {
  resolve: { conditions: ['development', ...defaultServerConditions] },
};
