### Fixes

- **Merge runner retries GitHub blips:** `gh pr merge` ending in `EOF` or `GraphQL: Something went wrong while executing your query` now counts as transient like a 5xx: the ready line stays and the gate runs again (up to three runs per head) instead of the PR being refused.
