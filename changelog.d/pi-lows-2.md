### Pi scripts and test kit (pi-lows-2)

- **Kit session teardown cutoff:** `kit-session.sh` now stores `STAMP_EPOCH` (seconds) next to `STAMP` and passes it as `SINCE_EPOCH`, so a daylight-saving change or a timezone change on the Pi cannot move the cutoff for which actors `MODE=down` deletes. An older state file without it falls back to `STAMP`.
- **Stage 15 confirm:** `CONFIRM=1` refuses while the safety revert service is running, instead of saying there is nothing to cancel.
- **Stage 11 asset folders:** refuses a link to a folder anywhere below `ddb-images` or `tokenizer`, not only the top folder.
- **Kit player run:** `player-run.mjs` reads `/api/status` and refuses the live world (or a server with no world) before it opens a browser. A repo folder named `..out` now counts as inside the repo, and the `--out` refusal test no longer depends on the working directory.
