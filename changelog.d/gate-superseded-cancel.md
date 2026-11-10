### Fixes

- **Merge gate and a superseded CI run:** `lane-merge.mjs` no longer refuses on a CANCELLED check from a run that a newer run of the same workflow replaced on the same head, and a job name that kept its unexpanded `${{ }}` expression (cancelled before it started) now shares a key with the expanded name of the newer run (Backlog `gate-superseded-cancel`).
