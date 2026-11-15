### Process

- **A review carries over when the patch did not change:** when no review note names the PR head,
  the merge gate compares the PR's own patch (`git patch-id --verbatim` of the diff from the merge
  base with main) at each reviewed commit and at the head. The same patch, as after a clean merge
  of main or a rebase without changes, carries the verdicts, and the gate output and the merge
  train note say `verdict carried from <sha>`. A conflict resolution, any changed line (whitespace
  counts) or any git error refuses as before (item review-carry-over).
