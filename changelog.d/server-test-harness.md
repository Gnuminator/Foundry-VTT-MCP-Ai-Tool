### Tests

- **One tool test harness:** `packages/mcp-server/src/test-support/make-tool-harness.ts` holds the shared logger stub and `makeTools` factory for server tool tests. A ratchet test counts test files that still carry their own copy (70 logger stubs, 29 `makeTools`) and fails if either number rises. The `tools/dnd5e` tests use the harness.
