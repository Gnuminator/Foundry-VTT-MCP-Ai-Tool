### Testing

- **Kit flake ledger:** `kit:run` keeps a per-scenario history on each PC (`scenario-history.json` in the kit folder) and the runs note gets a "Flaky scenarios" table: a scenario that passed and failed on the same git sha and world is marked flaky, and shows `(flaky)` in the failing list. `node scripts/test-kit/lib/flake-ledger.mjs backfill` seeds it from old reports. The `module-load` repeat failure on the srd world (25 dnd5e blindsight effect errors) is now an expected upstream finding.
