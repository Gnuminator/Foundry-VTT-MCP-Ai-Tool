### Pi

- **Deployed-state check, fewer silent passes:** `deploy/pi/deployed-state.sh` asks Docker only while `docker.service` runs (a
  stopped daemon is no longer started by the check) and warns when Docker is installed but not running or `docker ps` fails;
  a quoted empty env value (`NAME=""`) counts as missing; the Assistant GM helper hash now comes from the release tag's (or
  main's) git object and the line says which. `deployed-state.ps1` warns when no release tag comes back. Tests record every
  stub call and fail on anything but show, is-active, ps or inspect.
- **Pi health on the board:** stage 16's hourly report gains a `deployed` object (deployed ref, missing env names, libicu,
  compose containers' state, health and restarts; names and states only). The board endpoint must accept the new key before
  stage 16 is run again on the Pi.
- **Compose stage lows:** `MODE=up` is refused on any live port and on the live data folders, `--wait` covers only foundry,
  bridge and dashboard, a dry run writes no log, the cutover record is written through a temp file and cleared after a rollback,
  `docker info` has a timeout, stage 23 sets `live-restore`, the Assistant GM container clears stale Chromium `Singleton*`
  locks, and the guard hook asks before `docker rm`, `kill`, `system prune`, `compose down` and `TEST_ALLOW_CUTOVER=1` on a host.

### Docs

- **Access policy:** the security notes say the dashboard verifies the Access token itself and ignores the plain email header;
  `PLAYER_DASHBOARD_TOKEN` only takes effect with `GM_DASHBOARD_TOKEN` or `GM_EMAILS`.
