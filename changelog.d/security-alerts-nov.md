### Fixes

- **CodeQL shell-command finding in the Pi stage safety test:** the test now runs its bash script from a temp file instead of a `bash -c` string built from the node path (backlog item security-alerts-nov).
