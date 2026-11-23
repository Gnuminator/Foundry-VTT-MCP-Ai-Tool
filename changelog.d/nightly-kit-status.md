### Fixes

- The planner status "Kit" line shows the latest finished kit run, whoever started it, with its age,
  failing scenario ids and a later skip; it has no missing-nightly or stale warning. `last-run.json`
  keeps a `lastNightlyRun` entry next to `last` and `lastRun`.
