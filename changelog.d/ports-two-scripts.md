### Fixes

- **Port guard:** the port-literal test no longer counts timeout options such as `timeout: 30000` as ports, and the Obsidian test-vault script reads its dashboard port from `shared/ports.json`; the baseline is lowered to match (Backlog `ports-baseline-two-scripts`).
