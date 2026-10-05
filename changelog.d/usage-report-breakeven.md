### Development

- **Usage report: cost per request, startup and break-even:** `python scripts/dev/usage-report.py`
  takes `--curve` (cost per request by context size and a least-squares fit), `--startup` (what a
  fresh session costs in its first hour), `--breakeven` (how many requests until a handover to a
  fresh session is cheaper, and what cache expiry cost), `--all`, and `--json FILE`. It counts each
  API response once, keeps main thread and subagents apart, and reads only token numbers and
  timestamps from the transcripts. The default report is unchanged.
