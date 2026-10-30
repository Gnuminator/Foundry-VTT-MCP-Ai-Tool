### Tooling

- **Dashboard screenshots run in 4 parallel CI shards:** the `dashboard-visual` job is now four
  `dashboard-visual-shard` jobs (`--shard=i/4`, same image and baselines) plus a summary check still
  named `dashboard-visual (screenshots)`, so the merge gate needs no change. The diff report is one
  artifact per shard (`dashboard-visual-report-1` to `-4`). The baseline refresh workflow stays a
  single run.
