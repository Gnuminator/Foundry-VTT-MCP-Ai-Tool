### Tests

- **CI and test lows, sweep 2:** a pull request now also bundles the bridge with esbuild (`bundle-server` check), so an esbuild bump fails there and not at the next release. The kit's scene fixture tops up a fixture scene left without tokens by an interrupted run, `chooseStandardArrayMethod` has stub tests with a fake Playwright locator, the drift-check test for the worktree's own shared build now fails without that build, and a hook comment about `TEST_ALLOW_CUTOVER` says what the switch really skips.
