### Tests

- **Script tests are found by folder:** `scripts/checks.mjs` runs every `*.test.mjs` under `.claude/hooks`, `scripts`, `scripts/pi`, `deploy`, `installer` and `tools` through four folder checks (`hook-tests`, `script-tests`, `pi-tests`, `tool-tests`), so a new test file needs no edit there. Tests that another command runs are a short named list (`TEST_FOLDER_EXCEPTIONS`), and `coverage-check` still proves every test runs.
