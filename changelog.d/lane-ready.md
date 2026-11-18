### Process and tooling

- **`/ready` for lanes:** `node scripts/lane-ready.mjs` runs the merge gate's own dry run, checks that the PR names its Backlog item, and then either writes the ready line or prints one list of everything that is missing, so paperwork and drift refusals stop at the lane instead of at the merge runner (I-156).
