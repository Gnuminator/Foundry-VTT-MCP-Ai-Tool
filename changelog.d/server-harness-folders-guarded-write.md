### Tests

- **Guarded-write tests use the shared logger stub:** the three test files in `guarded-write/` build
  their logger with `makeLogger()` instead of their own copy, lowering the harness ratchet baseline by
  three (server-harness-folders).
