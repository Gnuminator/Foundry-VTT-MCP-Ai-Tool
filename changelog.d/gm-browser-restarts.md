### Orange Pi

- **The Assistant GM's nightly restart no longer warns (systemd):** the 04:30 backup stops Foundry, the Assistant GM leaves
  the game and systemd starts it again 15 seconds later, so its restart count grows by one a night. `deployed-state` now
  reads that as routine when the unit's last start fell between 04:30 and 08:00; a restart at any other time still warns, and
  five still fail. A unit the crash guard has stopped (failed state) now fails for every unit, the Assistant GM included.
  The Docker side keeps the old rule until the cutover sitting (`gm-browser-restarts`).
