### Development

- **ESLint 10 with a flat config (D-109, lint zero lane):** `.eslintrc.json` is replaced by
  `eslint.config.mjs` on ESLint 10 and typescript-eslint 8 (the user picked 10 over the 9 in the
  brief). It lints the same files. typescript-eslint 8 is stricter on the same code, so five rules
  that were already errors (unbound-method, no-unnecessary-type-assertion, prefer-optional-chain,
  no-base-to-string, no-duplicate-type-constituents) found 247 new hits; they stay errors and the
  hits are fixed (autofix, then hand-checked optional chains, and explicit primitive checks where
  a value was stringified). In tests, `@vitest/eslint-plugin`'s `unbound-method` replaces the
  typescript-eslint one, since `expect(mock.method)` is not an unbound call. The other new
  findings (stricter nullish checks, return types, preserve-caught-error and a few more) are
  warnings the lint ratchet counts; the baseline goes from 5999 to 6463.
- **Deliberate follow-ups for the lint zero sweep:** `reportUnusedDisableDirectives` is off,
  `no-unused-vars` has `caughtErrors: 'none'`, and the dashboard's React code has only the two
  classic hook rules (rules-of-hooks, exhaustive-deps). Each is switched on once its hits are
  fixed.
