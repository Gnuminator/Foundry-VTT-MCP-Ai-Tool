### Tests

- **Typecheck and tests read `shared` from source:** `@gnuminator/shared` has `exports` with a `development`
  condition that points at `shared/src`; typecheck passes `--customConditions development` and every
  Vitest config sets `ssr.resolve.conditions`. A fresh worktree typechecks and tests after `npm ci`
  without building `shared`. Release builds are unchanged (byte-identical output). `green --quick` fails
  with "run npm ci in this worktree" when `@gnuminator/shared` resolves outside the checkout.
- **The usage catalogue is generated, not committed:** `shared/src/usage-catalog.generated.ts` is
  gitignored and written by `npm ci` and the shared build, typecheck and test scripts; the Docker
  builds copy the module sources for that scan. `usage:catalog:check` now checks that the sources
  produce a valid catalogue.
- The Foundry module lists `@gnuminator/shared` as a dev dependency; the unused `@shared/*`,
  `@foundry-module/*` and `@mcp-server/*` path aliases are gone.
