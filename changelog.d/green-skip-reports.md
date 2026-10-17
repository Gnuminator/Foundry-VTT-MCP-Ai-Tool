### Tooling

- **`npm run green` ignores generated test reports:** the markdown lint now skips whatever `.gitignore` skips
  (`playwright-report/`, `test-results/`, `coverage/` and any new report folder), so a green after a failed e2e run
  passes without deleting files by hand.
