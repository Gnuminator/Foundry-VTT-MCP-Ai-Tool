### Orange Pi (D-112, D-113)

- **Stage 13 lets players make level-1 characters in Actor Studio at session 0:**
  `scripts/pi/remote/13-player-creation.sh` installs our Actor Studio fork build (`2.10.5-aitool.4`,
  pinned by version and sha256) and sets the world settings character creation needs. The zip is
  checked against the pinned checksum and listed before anything is extracted (no absolute paths,
  `..` parts, backslashes or links; `module.json` must say the right id and version); the old module
  folder moves to `prev-<time>/modules`, never deleted, and a second run at the same version changes
  nothing. Then, in each world, a headless Chromium joins as the world's GM
  (`scripts/pi/remote/player-creation-settings.mjs`, login from `world-<id>.env`, never printed) and
  sets Foundry's `ACTOR_CREATE` permission for Player and Trusted Player (the roles already there
  stay), Actor Studio's `enableEquipmentSelection`, and its equipment source
  `dnd-players-handbook.equipment`, and turns Actor Studio's per-user `usage-tracking` off for
  every user who has it saved as on; it reads the values back after a reload and fails on any
  mismatch. `options.json` goes back to the world it launched before, and a failed run puts it, the
  old module, Foundry and the Assistant GM browser back. The pinned build is the fork's
  `2.10.5-aitool.4` release, checked against its SHA-256; a pinned `PENDING-RELEASE` (a build
  without a release yet) makes the stage refuse to run without `STUDIO_ZIP` and `STUDIO_SHA256`. Tested in an ARM64 container (download and checksum of `aitool.3` and the
  pinned `aitool.4`, skip on a second run, wrong checksum, `..`, absolute, backslash and symlink
  zips, a failed swap, and the restore path with a faked systemd); the in-browser part ran twice
  against the PC test server's licensed kit world. The stage refuses to stop Foundry while people
  are online or when `/api/status` cannot be read (`FORCE=1` overrides), never replaces a newer
  installed build without `ALLOW_DOWNGRADE=1`, and leaves Foundry and the Assistant GM browser as
  it found them (stopped stays stopped).
