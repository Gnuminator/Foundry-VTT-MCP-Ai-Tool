### Fixes

- **Script messages and machine paths:** Plan B and backup scripts no longer name internal Waiting
  items in their errors, `start-bridge.cmd` uses the FAILED prefix with blank lines between messages,
  and the machine paths of Plan B, `pull-restic.ps1` and the module archive (Plan B root, test
  server, backup drive) now come from one file, `scripts/machine-paths.json`. The scheduled-task
  registrars and the other pull scripts still carry the drive letter (script-output-tidy).
