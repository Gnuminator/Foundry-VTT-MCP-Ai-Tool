### Pi setup (stage 14, system trial)

- **A new dnd5e version runs on the kit world first:** stage 14 (`14-system-trial.sh`) installs a pinned
  dnd5e release (the first is 6.0.6; the download must match its sha256 and fit the Pi's Foundry) and
  launches only `strahd-kit` on it, after keeping the old version and a copy of every world. `MODE=switch`
  then moves the campaign to the new version; `MODE=rollback` puts the old version back and resets
  `strahd-kit` from the copy. A world launched during the trial is not reset unless `RESTORE_MIGRATED=1`,
  and a rollback that stops halfway finishes on a second run. `MODE=status` shows where a trial stands.
  Nothing runs with people online (`FORCE=1` overrides), and a failed run puts back what ran before it.
  The trial and the switch wait for dnd5e's data migration in the Assistant GM browser when the new version
  asks for one, and a failed run launches a world again only on the version that world runs on. The copies'
  bytes are checked against the free space first, one run goes at a time, and every run is logged.
- **No other stage launches a world during a trial:** stages 5-check-world, 11 and 13 refuse to run while a
  trial is open, and stage 5's check world no longer replaces an installed dnd5e (a rerun after a switch used
  to put 6.0.5 back under migrated worlds).
- **The test kit runs during a trial:** `kit-session.sh MODE=up` accepts `strahd-kit` as the launched world
  while a dnd5e trial is open and puts Foundry back on it with `MODE=down`; with any other original world
  `MODE=down` is refused during a trial. Stage 14 refuses every mode but `status` while a kit session is up.
  A failed trial or switch now stops Foundry and the Assistant GM browser before it moves any world folder,
  and stage 3's `FOUNDRY_EXPECT_VERSION` also checks the installed program when no zip is given.
- **The Assistant GM driver declares its features:** `assistant-gm.mjs` has a
  `// assistant-gm features: extra-gm` line, and stage 11 checks that line instead of looking for an
  environment variable's name anywhere in the file (a comment no longer counts). A driver installed before
  this change is refused when an extra GM is involved: run stage 5 again first.
