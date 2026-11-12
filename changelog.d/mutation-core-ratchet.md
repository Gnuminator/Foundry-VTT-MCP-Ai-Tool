### Tests

- **Safety-core mutation survivors killed:** six new tests cover the top survivors of the 2026-11-11 mutation run on guarded writes: the feature switch of the asked feature, the redo refusal when a change left the history, the delete conflict check, the Foundry rollback after a failed vault write, the rollback order after a partial apply, and the vault re-check inside the file lock (Backlog `mutation-core-ratchet`).
