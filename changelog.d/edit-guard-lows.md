### Fixes

- **Edit guard lows (from the #358 round 2 review):** the shell edit guard no longer denies a script that
  reuses a loop variable name for something else (`for f in [...]`, then `f = tmp path`), and a heredoc
  redirect target is checked against the working directory at its own position on the line, so a
  `cd` after it on the same line no longer counts. Each has a test that fails on the old hook.
