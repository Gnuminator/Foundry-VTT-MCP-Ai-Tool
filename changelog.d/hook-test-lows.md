### Fixes

- **Hook test timing:** the guard-shell-edits "100 KB single token" speed test takes the best of three runs, so a busy machine no longer fails it while a really slow hook still does. The denied list also covers `p = p.replace(...)` on a loop variable.
