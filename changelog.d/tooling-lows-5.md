### Dev tooling

- **Merge lock and review-note lows:** `lane:merge` now reports a failed link back when it takes over a stale lock (a stderr warning when another run took the slot, the lock moved back where hard links are missing), waits and times out on a persistent takeover error instead of spinning, and a run releases only the lock it wrote (a token in the lock file). The shell-edit guard no longer treats `p = Path(p)` in a loop as a reuse of the loop variable. Doc and test touch-ups for the review-note format and the re-fetch order.
