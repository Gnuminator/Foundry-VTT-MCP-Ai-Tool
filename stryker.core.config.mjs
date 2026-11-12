/**
 * Stryker config for the safety core (guarded writes: plan, apply, undo, vault writes).
 * `npm run mutation:core` runs it through `scripts/mutation-ratchet.mjs`, which compares the score
 * with `scripts/mutation-baseline.json`. Weekly in `.github/workflows/mutation-core.yml`, never in
 * ci.yml (a run takes a long time).
 *
 * Shared is read from source (`vitest.shared-source.ts`), `ignoreStatic` skips the constant
 * initialisers that only run at import time and make most of a run's time.
 */
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.mutation-core.config.ts' },
  mutate: [
    'packages/mcp-server/src/guarded-write/service.ts',
    'packages/mcp-server/src/guarded-write/undo-planner.ts',
    'packages/mcp-server/src/guarded-write/undo-fold.ts',
    'packages/mcp-server/src/guarded-write/undo-state.ts',
    'packages/mcp-server/src/guarded-write/values.ts',
    'packages/foundry-module/src/data-access/guarded-write.ts',
    'shared/src/guarded-write.ts',
  ],
  ignoreStatic: true,
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  // In place: a sandbox copy leaves out gitignored files such as shared/src/usage-catalog.generated.ts
  // (the ratchet script generates it first). Stryker puts the seven mutated files back afterwards,
  // so do not edit them while a run is going; a hard-killed run leaves them mutated (the ratchet
  // script refuses to start on a dirty tree, `git checkout` puts them right). No type-check
  // preprocessing: the Vitest runner never type-checks, and it would rewrite every .ts file.
  inPlace: true,
  tempDirName: '.stryker-tmp',
  concurrency: 4,
  timeoutMS: 30_000,
  disableTypeChecks: false,
};
