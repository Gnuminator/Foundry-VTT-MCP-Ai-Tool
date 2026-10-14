### Pi scripts (lows batch)

- **Stage 15 (SSH keys only):** the CONFIRM step checks the live daemon and the drop-in again before it stops the safety timer; a `Match` line written `Keyword=value` is read correctly; a failed reload or a dead sshd rolls back or restarts it and leaves the timer armed when ssh is not active again; the port lookup reads all of `sshd -T` (no SIGPIPE).
- **Stage 5 (tool):** the load check also loads the Discord bot's voice code, fails when the build leaves more than the console handles open, and says "timed out after N seconds" when it times out.
- **Stage 9 (ssh log):** the timer check uses `systemctl is-active --quiet`.
- **Stage 11 (world):** refuses, before anything stops, when `ddb-images` or `tokenizer` in the world data is a link.
- **Kit session:** `MODE=down` deletes only the actors `Kit Player` owns that were made after `up`; older owned actors are kept and listed. The kit refuses nothing new for a normal session, since the actors it makes are all newer.
- **Test kit:** `scripts/test-kit/player-run.mjs` is the player run (a Player builds a level 1 character with the standard array, the kit's sheet checks judge it); output goes to `--out` or a temp folder.
- **Tests:** more container scenarios for stages 11 and 15, and tests for `5-check-world`.
