### Fixes

- **A large control reply no longer drops the dashboard's channel:** a single tool result over 1 MB
  (for example `get-play-stats` in a world with a long play log) made the dashboard log "Control
  buffer overflow" and reset the control connection, failing every pending request. The size limit
  now applies only to one unfinished line and is 32 MB, so big replies arrive in many chunks and
  resolve; a line that never ends still resets the connection, and the log now says how large it was.
