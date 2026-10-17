### Tooling

- **`drift:check` builds `shared` from the merged tree:** when the trial merge changes `shared/`, the throwaway
  worktree gets its own workspace links and builds its own `shared`, so a PR is no longer tested against the lane's
  older `shared/dist` (the case where a PR that added a `shared` export is merged under one that predates it).
