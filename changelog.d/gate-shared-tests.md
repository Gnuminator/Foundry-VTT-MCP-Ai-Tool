### Fixes

- **Merge gate runs the shared unit tests:** the drift check now runs `npm test -w @gnuminator/shared`
  on the merged tree whenever `shared/` changed, so a shared change that breaks them is refused
  before merge. The gate also treats a cancelled CI check of a mixed run as blocking, and a matrix
  leg skipped by `if:` in a newer run clears an older cancelled shard check.
