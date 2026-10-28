### Fixes

- **Session notes say when Claude is logged out:** when the `claude` command on the PC has lost its
  login, the notes run now stops at the first scene and writes "Claude is not logged in on this PC
  (open a terminal, run claude, then /login)" to `notes/status.json`, instead of trying every scene
  twice and reporting only "kept raw" with no reason.
