### Fixes

- **Board PRs now show for the planner:** `backlog.mjs status --planner` lists the PM board repo's open PRs with CI and the verdict of their `board-<n>-review.md` note, and the lane skill says how a board PR gets merged (the planner merges it after CI `test` is green and a note for the head says Merge; the merge runner only handles tool-repo PRs).
