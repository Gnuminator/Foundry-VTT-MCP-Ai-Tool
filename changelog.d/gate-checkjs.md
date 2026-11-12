### Fixes

- **Gate scripts are typechecked:** `checks.mjs`, `green.mjs`, `lane-merge.mjs` and `drift-check.mjs` now carry `// @ts-check` and are checked by `npm run typecheck` (so in green and CI) through `scripts/tsconfig.json`. Types and JSDoc only, no behaviour change.
