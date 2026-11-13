### Fixes

- **The merge runner restarts itself when its code changes:** at the start of each round it compares
  its own files with `aitool/main`. When they differ it fast-forwards the main checkout and runs
  itself again as a child; if the checkout cannot be updated it posts one #pr-log line and exits 3.
  A runner started before a merge no longer keeps running the old code (item
  `runner-restart-on-change`).
