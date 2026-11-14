### Internal

- **One copy of small helpers (mcp-server):** `isRecord`, `asRecord` and `sleep` now live once in
  the shared package, and the Obsidian and vault code uses them instead of private copies. No
  behavior change.
