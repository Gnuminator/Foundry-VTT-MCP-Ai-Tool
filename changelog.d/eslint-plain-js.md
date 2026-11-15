### Tests

- **ESLint now lints plain JavaScript:** the untyped recommended rules run on the tracked `.js`, `.mjs` and `.cjs`
  files, `.claude/hooks` included, and the findings are fixed. A test fails if ESLint ignores a tracked plain JS file
  that is not on the named skip list in `eslint.config.mjs`.
