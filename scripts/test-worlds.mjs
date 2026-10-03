/**
 * The local test worlds the live scripts (`live-roundtrip.mjs`, `live-write-sweep.mjs`) may write
 * to. `ai-tool-test` is the everyday test world; `ai-tool-walkthrough` is the module walkthrough's
 * copy of the old campaign world. Never a real campaign, and never `ai-tool-kit` (licensed
 * content). The Foundry module keeps the same list (`SWEEP_WORLD_IDS` in
 * `packages/foundry-module/src/live-sweep.ts`); a module test pins the two copies together.
 */
export const TEST_WORLDS = Object.freeze(['ai-tool-test', 'ai-tool-walkthrough']);

/** The default world when no `--world` is given. */
export const DEFAULT_TEST_WORLD = 'ai-tool-test';

/**
 * The world named by `--world <id>` (or `--world=<id>`) in `argv`, the default when absent.
 * Throws for a world that is not in {@link TEST_WORLDS}, or for `--world` without a value.
 */
export function parseWorldArg(argv) {
  let value = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--world') {
      value = argv[i + 1] ?? '';
      break;
    }
    if (arg.startsWith('--world=')) {
      value = arg.slice('--world='.length);
      break;
    }
  }
  if (value === null) return DEFAULT_TEST_WORLD;
  if (!TEST_WORLDS.includes(value)) {
    throw new Error(`--world must be one of ${TEST_WORLDS.join(', ')} (got "${value}")`);
  }
  return value;
}
