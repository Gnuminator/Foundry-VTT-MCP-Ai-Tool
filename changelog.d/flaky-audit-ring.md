### Fixes

- **Flaky audit test:** "keeps every history line even past the ring size" no longer does 505 fsync'd rewrites in one test (it timed out at 30 s on a loaded disk); it seeds a full ring in one write and appends 5 more. The audit code is unchanged.
