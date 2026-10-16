### Fixes

- **Pi scripts lows, round 3 (#354 review):** the second `revert_running` check in stage 15 CONFIRM now has its own container scenario (`confirm-revert-starts`: the revert service starts while CONFIRM stops the timer, no marker); `player-run.mjs` refuses the live world by name and before it makes a temp folder, so a refused run leaves nothing behind; the kit-session teardown notes say "timezone change" instead of "clock step", because `STAMP_EPOCH` fixes DST and timezone changes only.
