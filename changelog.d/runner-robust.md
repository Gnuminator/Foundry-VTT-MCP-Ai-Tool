### Process

- **The merge runner needs no oversight:** at "merge train full" it skips the PRs that count toward
  the train and merges the others, then queues for test server A's lock, runs `live:roundtrip`
  (plus `live:sweep` when module or tool sources changed) on main and resets the train itself; on
  red it posts a bisect hint in #pr-log and stops. An item can hold one ready line per PR, so a
  merge never removes another PR's ready line, and `backlog.mjs progress` refuses text that says a
  PR is ready without `--ready`.
