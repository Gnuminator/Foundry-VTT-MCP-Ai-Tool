### Tests

- **GitHub merge queue for main:** CI also runs on `merge_group`, so queued PRs are tested together on
  top of each other in parallel. The merge gate enqueues a PR (instead of merging it) when main's
  ruleset has a merge queue, and merges as before when it has none. The merge runner no longer waits
  for main's CI between PRs when a queue is on, follows each queued PR to merged (or takes it off the
  merge train when it leaves the queue), and reruns a check that sits in progress for over 20 minutes
  while its run is completed (item github-merge-queue).
