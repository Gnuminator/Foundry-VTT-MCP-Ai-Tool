### Fixes

- **Server tests share one tool harness:** the last seven own `makeTools` copies and the last two own logger stubs in `packages/mcp-server` tests now use `make-tool-harness.ts` or `makeLogger`; both harness ratchet counts fall to 0.
