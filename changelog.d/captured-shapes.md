### Tests (captured-shapes)

- **Captured Foundry shapes:** `scripts/test-env/capture-shapes.mjs` records the data paths and types of real Foundry 14 / dnd5e 6 documents from a test server as JSON next to the Foundry mock, and a contract test fails when the mock's documents drift from them (the known gaps are listed in the test and only shrink).
- **Shared change summary:** the bridge's change list is written once from the real change history into a shared fixture that the bridge test, the dashboard's Recent Changes tests and the dashboard's fake bridge all check against.
