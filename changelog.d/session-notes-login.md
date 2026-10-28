### Fixes

- **Session notes say when Claude is logged out:** when the `claude` command on the PC has lost its
  login, the notes run now stops at the first scene and writes "Claude is not logged in on this PC
  (open a terminal, run claude, then /login)" to `notes/status.json`, instead of trying every scene
  twice and reporting only "kept raw" with no reason.
- **Session notes calls are much lighter:** each Claude call of the notes writer no longer loads the
  PC's connectors, skills and settings (about 180k tokens of context per call; a 5-line test
  recording went from 365k to 10k input tokens).
