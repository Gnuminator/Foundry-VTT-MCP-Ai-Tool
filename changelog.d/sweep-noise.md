### Fixes

- **`live:sweep` clean-up noise (#331 round 2 L1, L3):** the clean-up no longer reports a FAIL line when the handout page it wanted to unqueue is already out of the reveal queue, and the coverage test reads the tool lists of `tool-sets.ts` without being cut off by a `]` inside a comment.
