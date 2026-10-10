### Pi setup (stage 14, system trial)

- **A new dnd5e version runs on the kit world first:** stage 14 (`14-system-trial.sh`) installs a pinned
  dnd5e release (the first is 6.0.6; the download must match its sha256 and fit the Pi's Foundry) and
  launches only `strahd-kit` on it, after keeping the old version and a copy of every world. `MODE=switch`
  then moves the campaign to the new version; `MODE=rollback` puts the old version back and resets
  `strahd-kit` from the copy. A world launched during the trial is not reset unless `RESTORE_MIGRATED=1`,
  and a rollback that stops halfway finishes on a second run. `MODE=status` shows where a trial stands.
  Nothing runs with people online (`FORCE=1` overrides), and a failed run puts back what ran before it.
- **The Assistant GM driver declares its features:** `assistant-gm.mjs` has a
  `// assistant-gm features: extra-gm` line, and stage 11 checks that line instead of looking for an
  environment variable's name anywhere in the file (a comment no longer counts). A driver installed before
  this change is refused when an extra GM is involved: run stage 5 again first.
