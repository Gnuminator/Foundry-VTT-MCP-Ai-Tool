### Fixes

- **Recorder survives a full disk, a crash and a quick restart:** every recording file now has an
  error handler, so a full disk or a permission error no longer kills the bot; the channel and the
  owner get a message and `/record stop` warns that the recording may be incomplete. A `/record stop`
  then `/record start` in the same minute gets its own folder (`...-discord-2`) instead of
  overwriting the first run's tracks. On startup the bot converts any recording a crashed run left
  raw (no `convert-report.json`, untouched for 10 minutes) and tells the owner.
