### Orange Pi (Part C follow-up)

- **`set-dashboard-access.sh`:** whitespace and newlines are now removed from the `--team` value
  like every other answer, so a value with a newline can no longer write an extra line into
  `dashboard-access.env`. The one-time link note and the guide now say the browser's history
  may still list the first visit with the token: open the link in a private window or delete
  that history entry.
- **Stage 11:** the "no Foundry connection in the bridge log" warning was a false alarm (the
  bridge does not log connects). It now looks for an established TCP connection on the bridge's
  Foundry port 31415, still only a warning.
