### Fixes

- **Tarokka clear:** `clear: true` with a `source` or `userId` is now refused with a clear message instead of silently clearing and dealing nothing. The Obsidian notes say "No current reading" after a clear, and an archived reading is described as no longer current (replaced or cleared). A test covers a clear plan that goes stale when a reading is imported after it.
