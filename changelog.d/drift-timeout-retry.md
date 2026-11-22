### Fixes

- **The merge gate no longer calls a slow PC "drift":** when a drift guard fails only on Vitest test timeouts, it is rerun once, and a second timeout is reported as "gate timeout, not drift" and treated by the merge runner as transient (backlog `drift-timeout-retry`).
