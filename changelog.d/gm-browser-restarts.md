### Orange Pi

- **The Assistant GM's nightly restart no longer warns:** the 04:30 backup stops Foundry, the Assistant GM leaves the game
  and systemd starts it again 15 seconds later, so its restart count grows by one a night. `deployed-state` now counts that
  as routine (a crash loop for this unit needs 30 restarts, or it being stuck in auto-restart; the crash guard still stops a
  fast loop). Without this the count would have reached the old limit of 5 and read as a crash loop (`gm-browser-restarts`).
