### Fixes

- **Green tree hash:** `worktreeTreeHash` copies the real index with the real index's mtime (floored to the second), so git's racy-stat check still re-hashes a same-size edit made in the second of the last git command. On Linux the plain copy got a fresh mtime and a second boundary between two hashes could return a stale tree (the CI flake in the worktreeTreeHash test); the new test pins the second and fails without the fix.
