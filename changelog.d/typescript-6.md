### Tooling (typescript-7, step 1)

- **TypeScript 6.0 in every workspace:** all packages move from 5.9 to 6.0.3. The root and ESLint tsconfigs
  drop the deprecated `baseUrl` (TS 7 removes it), `shared` and the ESLint project name their `@types`
  explicitly (TS 6 no longer loads them on its own), and the module's unused `@gnuminator/shared` path
  alias is gone. No runtime change.
