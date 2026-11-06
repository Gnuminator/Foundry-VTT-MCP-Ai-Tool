### Docs

- **The guides can no longer name a button that is not there:** `npm run docs:ui` (also in CI and `green`) reads every bold button, tab, panel or drawer name in `docs/gm`, its Danish twins and the smoke checklist, and fails when no dashboard or module string has it. Foundry's own buttons are listed with a reason in `scripts/docs-ui-exceptions.json`.
- **The test kit page counts for itself:** the scenario table, the scenario counts per size and the number of kit worlds in `docs/dev/TEST-KIT.md` are generated from `scripts/test-kit/scenarios/` (`npm run docs:kit`; CI fails on a stale table). The page said 24 scenarios; there are 28.
