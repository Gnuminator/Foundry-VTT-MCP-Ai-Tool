### Dev tooling

- **Model guard hook:** `.claude/hooks/guard-model.mjs` (a PreToolUse hook on `Agent`, `Task` and `start_session`) refuses a call with no `model`, because an unset model inherits the caller's and an Opus session then starts Opus workers and lanes. Forks, starting an already proposed card and the title-only offer card are exempt. Tests run in CI and `npm run green`.
