### Process tooling

- **Mirror tests under load:** the temp-folder teardown in the Obsidian tests (`packages/mcp-server/src/obsidian/`) goes through `rmTmp` (`src/test-support/rm-tmp.ts`, `fs.rm` with retries), so a locked folder on Windows no longer fails with ENOTEMPTY, and the mcp-server vitest test and hook timeouts are 30 s instead of 5 s, so the gate's drift check and parallel green runs stop refusing a PR on load-sensitive tests (`mirror-pump-flake`).
