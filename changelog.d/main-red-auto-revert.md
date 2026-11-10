### Tests

- **A red main reacts by itself:** when a CI run on main fails, a new workflow reruns the failed jobs once; if the rerun fails too it opens a draft PR that reverts the merge that turned main red. The PR is never merged automatically (Backlog: main-red-auto-revert).
