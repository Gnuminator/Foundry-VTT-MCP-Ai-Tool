# Test kit scenarios

Scenario files for the test kit: `<id>.scenario.mjs`, each with a default export in the shape
`Scenario` from `../lib/contract.mjs`. Only scenarios that need no licensed content belong here;
licensed ones stay on the PC and are loaded with `--scenarios <dir>`. A scenario names documents
by name or id and never carries book text.

Run `node scripts/test-kit/kit.mjs check` to validate them against the tool catalog.
