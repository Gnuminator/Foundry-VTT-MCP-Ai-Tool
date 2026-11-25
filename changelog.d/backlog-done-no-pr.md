### Fixes

- **Backlog tool:** `backlog.mjs done <id> --no-pr --summary <text>` closes an item finished by a check or a live action with a line that says "done without a PR" instead of claiming a merged PR. `claim` now refuses only an item whose newest progress line says a PR merged, not any line with the word "fixed".
