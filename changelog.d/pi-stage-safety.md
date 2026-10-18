### Orange Pi

- **Stage scripts no longer disturb a game night (deep review r37 S1 to S5):** `lib.sh`'s `enable_unit`
  restarts a running service only when its unit file or a listed settings file changed in that run (or with
  `RESTART_UNITS=1`); a rerun that changed nothing leaves Foundry, the bridge, the dashboard, the Assistant GM
  and the tunnel running. Any stage that stops or restarts a service first refuses while players are online
  (Foundry's `/api/status`, the Assistant GM browser counted as one) or a Discord recording runs, and every
  stage refuses without a `dietpi-backup` snapshot from today; `FORCE=1` in front of `bash` overrides.
  Stages 5 and 12 warn when the dashboard player/GM split is off.
- **Safer installs:** stage 2 pins Node (`NODE_VERSION`, default v24.21.0) instead of following
  `latest-v24.x`; stages 2 and 3 unpack next to the old folder and swap, instead of `rm -rf dir/*` first.
- **Backups and sync:** stage 8 adds the recordings folder to dietpi-backup's exclude list (D-126 q26);
  the Syncthing ignore list on the Pi (stage 7) and on the PC (`setup-syncthing-pc.ps1`) adds
  `.obsidian/plugins` and `.obsidian/community-plugins.json` (D-126 q28). All of it reaches the Pi on the
  next run of each stage.
