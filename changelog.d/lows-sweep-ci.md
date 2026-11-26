### Tests

- **CI lows sweep:** every job in every workflow now has `timeout-minutes`, and `workflow-pins.test.mjs` requires one; `npm run ci:health` also prints the last run of `mutation-core`, `pi-images` and `release`; the pre-commit formatter covers `.tsx`, `.mjs` and `.cjs` files too (the unused `format:check` script is removed); the test typecheck ratchet's `--update` refusal has a unit test.
