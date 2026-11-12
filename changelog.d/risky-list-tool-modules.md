### Fixes

- **Merge gate risky list:** tool modules, `tool-sets.ts`, `tool-budgets.ts` and `tools/player.ts` now count as wire contracts, and `tools/modules/guarded-changes.ts` as guarded writes, so a PR touching them needs an Opus review (Backlog `risky-list-tool-modules`).
