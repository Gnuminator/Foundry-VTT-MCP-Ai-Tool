### Development

- **ESLint 10 with a flat config (D-109, lint zero lane):** `.eslintrc.json` is replaced by
  `eslint.config.mjs` on ESLint 10 and typescript-eslint 8 (the user picked 10 over the 9 in the
  brief). It lints the same files with the same rules. The findings that are new with the newer
  rule sets (unbound methods, needless type assertions, stricter optional chains and nullish
  checks, and a few more) are warnings that the lint ratchet counts, so the baseline rises once to
  6716; the lint zero sweep takes them to zero.
