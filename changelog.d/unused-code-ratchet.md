### Tests

- **Unused code can no longer grow:** knip counts unused files, exports and types per package
  (`knip.json`, `scripts/unused-baseline.json`); CI fails when a count goes up
  (`npm run unused:ratchet`, `-- --update` lowers it). `docs/dev/ARCHITECTURE.md` now says the older
  permission layer guards actor creation and journals only.
