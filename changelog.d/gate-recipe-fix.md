### Tooling

- **The lane skill's gate recipe is pinned by a test:** the dry-run recipe must extract `scripts/lane-merge.mjs` and `scripts/lane-merge/` from main together; a test fails if it goes back to copying only the entry file.
