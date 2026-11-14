### Tests

- **Handouts tests use the shared logger stub:** the three test files in `handouts/` build their logger
  with `makeLogger()` instead of their own copy, lowering the harness ratchet baseline by three
  (server-harness-folders).
