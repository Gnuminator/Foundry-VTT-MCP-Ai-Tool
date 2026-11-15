### Tests

- **Tarokka and session-notes tests use the shared logger stub:** the two service tests build their
  logger with `makeLogger()` instead of their own copy, lowering the harness ratchet baseline by two
  (server-harness-folders).
