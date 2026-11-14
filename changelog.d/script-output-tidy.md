### Fixes

- **Script messages and machine paths:** Plan B and backup scripts no longer name internal Waiting
  items in their errors, `start-bridge.cmd` uses the REFUSED and FAILED prefixes with blank lines
  between messages, and the machine paths (Plan B root, test server, backup drive, module archive)
  now come from one file, `scripts/machine-paths.json` (script-output-tidy).
