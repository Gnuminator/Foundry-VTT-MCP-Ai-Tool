### Tooling (D-127; review-runner)

- **Review runner on the API credit:** `node scripts/review-runner/run.mjs <PR>...` reviews pull
  requests with the Claude Agent SDK on a separate API key (`REVIEW_RUNNER_API_KEY`), writes the
  review note in the merge gate's format to the vault, commits it, logs each review's cost and stops
  at $95 in total. `--dry-run` shows the plan and spends nothing. The `lane` skill carries the
  hybrid review rules: one round plus one delta check, a third round needs the planner, low-risk
  PRs are reviewed in batches.
