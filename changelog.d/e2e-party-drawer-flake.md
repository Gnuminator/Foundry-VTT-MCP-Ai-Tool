### Fixes

- **Flaky dashboard e2e test:** the "GM Actions gate shows the docked Pre-flight" test clicked in the Party drawer before Pre-flight had docked, so Pre-flight floated over Party and Party stayed open. The test now waits for the docked Pre-flight first. No product change.
