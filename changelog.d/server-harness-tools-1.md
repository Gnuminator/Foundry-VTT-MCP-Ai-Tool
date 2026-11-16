### Fixes

- **Server test harness, tools batch 1:** 18 small tool test files use the shared `make-tool-harness.ts` instead of their own logger stub and `makeTools`; the harness ratchet baseline drops to 39 logger stubs and 22 `makeTools` copies (test-only).
