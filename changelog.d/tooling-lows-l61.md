### Tooling (review lows of #731, #744, #756, #784)

- **Weekly usage report:** the lane line changes at the merge time of the lines PR, not at midnight; the
  lane columns read "reached line" and "peak after line"; a session's first response is not counted as
  confirmed (stricter than the context hook, which counts a single response).
- **Release gate:** the version fields in `package-lock.json` are compared by package key, so a version that
  moves between entries is refused.
- **Lane skill and hook tests:** the skill says a lane must be started in its worktree; the context hook
  tests lost the unused offset and regained a case for a non-writing command above the out line.
- **Preflight:** the connector line prints the bridge's current version.
