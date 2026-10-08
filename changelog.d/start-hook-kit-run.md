### Developer tools (D-102)

- **Start alerts hook:** a project SessionStart hook (`.claude/hooks/start-alerts.mjs`) that
  prints nothing when all is fine and otherwise up to nine short lines: `CLAUDE.md` differs from
  the vault master, who holds the test server lock, lanes at 200k context or more, and a missed or
  paused session-notes run (the last two from the control center).
- **Kit run command:** `npm run kit:run` takes the test server lock, builds, restarts the test
  environment on the kit world, runs the test kit, stops the environment, releases the lock and
  records the result in `<kit home>/last-run.json` and the vault note `Test kit runs.md`. On
  demand, or overnight with `--nightly` (`scripts/test-kit/register-nightly.ps1` registers the
  scheduled task).
