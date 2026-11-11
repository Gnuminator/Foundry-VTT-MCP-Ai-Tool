### Fixes

- **Module error log no longer files early errors under the previous world:** errors captured
  before the world is known stay in memory and are saved once the world is bound, so a world
  switch cannot leave them stored under the old world's marker (backlog `diagnostics-early-errors-world`).
