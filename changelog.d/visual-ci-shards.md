### Tooling

- **Dashboard screenshots run in 4 parallel CI shards:** the `dashboard-visual` job is now four
  `dashboard-visual-shard` jobs (`--shard=i/4`, same image and baselines) plus a summary check still
  named `dashboard-visual (screenshots)` (the gate judges every check, shards included, so it needs
  no change; the visual part takes about 5 minutes instead of 14). The diff report is one
  artifact per shard (`dashboard-visual-report-1` to `-4`). The baseline refresh workflow stays a
  single run.
