### Tooling

- **One copy of small helpers (co-GM dashboard server):** `isRecord`, `asRecord`, `sleep` and
  `errorMessage` now come from the shared package in the dashboard's server code instead of
  private copies. No behavior change, except that a non-Error value in a log line is now written
  as JSON instead of `[object Object]`.
