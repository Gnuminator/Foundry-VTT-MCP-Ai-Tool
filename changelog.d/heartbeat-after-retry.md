### Fixes

- **Module heartbeat after a late connect:** when the first connect to the AI Tool server fails and a background retry later succeeds, the module now starts its heartbeat and reports the link as connected. The first-connect warning no longer promises a retry for a settings error (Backlog `ready-heartbeat-after-retry`).
