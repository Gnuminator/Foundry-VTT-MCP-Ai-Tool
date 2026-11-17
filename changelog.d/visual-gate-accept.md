### Fixes

- **Merge gate checks the dashboard visual diff:** `lane-merge` reads the `dashboard-visual-diff` artifact of the head run and refuses a PR whose story shots differ from main until its review note for that head carries `visual: accepted <n> <hash>`. No diff, a skipped visual job or no report job needs no line; a missing artifact, a report for another head or a stale line refuses. The `lane` skill says how to write the line.
