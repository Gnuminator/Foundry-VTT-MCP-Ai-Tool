### Development

- **Lanes pick the reviewer with the merge gate:** the `lane` skill now has lanes run the gate's
  `--dry-run` before the first review and use Opus whenever the gate says the PR is risky, so a
  Sonnet review on a risky PR is no longer wasted.
