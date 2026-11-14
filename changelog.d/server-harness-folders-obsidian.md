### Tests

- **Obsidian tests use the shared logger stub:** the five test files in `obsidian/` build their logger
  with `makeLogger()` instead of their own copy, and the harness ratchet baseline drops from 69 to 64
  logger stubs (server-harness-folders).
