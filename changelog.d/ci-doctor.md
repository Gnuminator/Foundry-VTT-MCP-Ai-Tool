### Tests

- **ci-doctor agent:** `npm run ci:evidence -- <PR>` collects the failed checks, annotations and log
  tail of a red PR head into one file, and the read-only `ci-doctor` agent (Read, Grep, Glob only, so
  it cannot push or raise a baseline) names the cause and drafts a fix for the known kinds.
