### Process

- **CI skips the Pi scripts group on a pull request that touches no Pi input:** `build-test` shows a "pi: skipped" summary line and stays green, so the required checks never hang. Pushes to main, merge_group and dispatch runs always run it. The three Pi checks that read package sources and docs (world switches, runtime imports, Obsidian guides) moved to the scripts group, so they never skip (I-159).
