### Orange Pi

- **Game-night watch: the stage 29 check runs again.** `CHECK=1` stopped with "not found" because Node itself reads
  `--env-file` anywhere on the command line, so the watch's comma-joined list never reached the watch. The flag is now
  `--env-files`.
- **Game-night watch: fewer false alarms and clearer failures.** A night that is still marked open but quiet for 2
  hours, with Foundry down (the 04:30 backup), no longer alarms; the end post says "the session has ended or has gone
  quiet"; the recorder probe tells "not running" from "cannot tell"; a settings problem (a bad number or address, or a
  public address on plain http while the Access token is set) stops the service for good instead of restarting it every
  ten seconds; an unreadable session answer is logged once; stopping the service cannot post a message twice.
- **Stage 29 waits for the watch.** After the start it waits for the "watching" line and fails loudly when the unit
  stopped first. `set-discord-token.sh` and stage 26 restart the watch after a token or channel change. The container test
  covers the restart rules with a fake systemd.
