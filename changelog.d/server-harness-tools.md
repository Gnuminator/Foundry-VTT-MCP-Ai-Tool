### Fixes

- **Server tests share one logger stub:** the tool tests under `packages/mcp-server/src/tools` now use `makeLogger` instead of their own copies; the harness ratchet falls from 20 to 2 own logger stubs.
