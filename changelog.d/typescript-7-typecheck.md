### Tooling (typescript-7)

- **Typecheck and builds use the TypeScript 7 compiler:** every workspace runs `tsc` 7.0.2 through the
  `typescript7` npm alias (`scripts/tsc7.mjs`); the whole-repo `npm run typecheck` drops from about 13 s to
  about 4.5 s. typescript-eslint and the other tools stay on the `typescript` 6.0 package.
