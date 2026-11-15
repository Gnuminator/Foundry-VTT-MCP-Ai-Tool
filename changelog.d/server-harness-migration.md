### Tests

- **One test harness, first folder moved:** the server tool tests' logger stub now lives in one place (`test-support/stub-tool-deps.ts`), and the scene-restore tests use the shared `makeTools` from `test-support/make-tool-harness.ts` instead of their own copy. The ratchet baseline drops to 69 logger stubs and 28 `makeTools` copies (server-harness-migration).
