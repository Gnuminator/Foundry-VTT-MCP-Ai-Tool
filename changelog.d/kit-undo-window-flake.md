### Tests

- **The dashboard-controls sweep no longer loses its Undo window to old vault logs:** after a few full kit builds the kit world's vault held tens of megabytes of old session and change logs, so `get-prep-digest` and the change list outlasted the dashboard's 15 second limit, the bridge link dropped and the Undo window did not open after the Everyone tab step. The sweep now moves dated logs over 2 MB from days before today to `vault-archive/<world>/` next to the vault (kept, not deleted) before it starts.
