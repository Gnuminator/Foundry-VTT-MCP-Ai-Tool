### Fixes

- **The player helper guide follows the table:** `get-helper-guide` in the player extension now asks the table for its current guide first and uses the bundled copy only when the table does not answer, so the guide no longer goes stale against the table's tool list. The bundled instructions no longer say the tool list is closed (backlog `wrapper-guide-from-table`).
