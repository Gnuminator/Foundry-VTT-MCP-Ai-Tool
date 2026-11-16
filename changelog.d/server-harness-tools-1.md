### Fixes

- **Server test harness, tools batch 1:** 19 small tool test files use the shared `make-tool-harness.ts` instead of their own logger stub and `makeTools`; the harness ratchet baseline drops to 38 logger stubs and 21 `makeTools` copies (test-only).
