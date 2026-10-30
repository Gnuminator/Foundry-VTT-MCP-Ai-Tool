### Tooling

- **The merge gate builds `shared` when it has to:** `drift-check` (which the gate runs from main's
  copy) now builds `@gnuminator/shared` in the lane checkout when `shared/dist` is missing or older
  than `shared/src`, before the mcp-server tests run, so a docs-only lane no longer fails with
  "Failed to resolve entry for @gnuminator/shared". A failed build stops the check with its output.
