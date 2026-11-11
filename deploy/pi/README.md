# The Pi stack in containers

`compose.yml` runs Foundry, the bridge, the co-GM dashboard and the Assistant GM browser as containers on the
Orange Pi, next to the systemd units that run them today. Nothing here changes the Pi by itself: the stage scripts
`scripts/pi/remote/23-docker.sh` (install Docker, build the images) and `scripts/pi/remote/24-compose.sh` do that,
each only with a `dietpi-backup` snapshot and an OK first (see the `pi-work` skill).

## What runs where

| In a container                                                                                               | Stays on the host                                                   |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| foundry (`node:24-trixie-slim`, the host's `/opt/foundry` mounted read-only, nothing licensed in the image)  | Syncthing                                                           |
| bridge (control 31414, Foundry link 31415)                                                                   | cloudflared (the tunnel)                                            |
| dashboard (port 3000)                                                                                        | Tailscale and `tailscale serve`                                     |
| gm-browser (Chromium with `--no-sandbox` through `/usr/local/bin/chromium-nosandbox`, low CPU weight, I-098) | the Discord recorder, the GitHub runner, the stage scripts, backups |

Every container uses `network_mode: host`, so the loopback ports are the same ones as under systemd and Tailscale
serve, the tunnel and Plan B need no change. The env files in `/etc/foundry-ai-tool/` are read as they are.

## Settings

Defaults are the live values. Put overrides in `deploy/pi/.env` (stage 23 writes it) or the shell.

| Variable                       | Default                    | Meaning                                                                  |
| ------------------------------ | -------------------------- | ------------------------------------------------------------------------ |
| `FOUNDRY_UID`, `FOUNDRY_GID`   | required                   | the foundry user's ids; every container runs as it                       |
| `FOUNDRY_HTTP_PORT`            | 30000                      | Foundry's port                                                           |
| `BRIDGE_CONTROL_PORT`          | 31414                      | the bridge control port (`MCP_CONTROL_PORT`)                             |
| `BRIDGE_LINK_PORT`             | 31415                      | the Foundry link (the bridge reads it as `FOUNDRY_PORT`)                 |
| `DASHBOARD_PORT`               | 3000                       | the dashboard                                                            |
| `DASHBOARD_ALLOWED_HOSTS`      | empty                      | the Pi's tailnet name                                                    |
| `FOUNDRY_AI_PLAYER_VAULTS_DIR` | empty                      | the player vaults folder (stage 21's drop-in, copied by stage 23)        |
| `FOUNDRY_APP_DIR`              | `/opt/foundry`             | Foundry's program files                                                  |
| `FOUNDRY_DATA_DIR`             | `/var/lib/foundry`         | Foundry's data                                                           |
| `TOOL_DATA_DIR`                | `/var/lib/foundry-ai-tool` | vault, dashboard state, browser profile; mounted at the same path inside |
| `TOOL_ETC_DIR`                 | `/etc/foundry-ai-tool`     | the four env files (all optional to compose)                             |

An env file must not set the ports or the folder variables above: `environment:` in the compose file wins over it.

## Rehearse beside the live stack

Use other ports and your own data folders, never the live `FOUNDRY_DATA_DIR` (two Foundrys on one data folder
corrupt it). `test.env` holds the rehearsal ports 30100, 31614, 31615 and 3300 (D-119). Both data folders must be
absolute paths for `up` and `cutover` (compose and the stage script would resolve a relative one against different
folders); `down` and `rollback` ignore that rule so the way out is never blocked. Write the plain value in an env file:
`up` and `cutover` refuse a `$` or a backslash in the four ports, `FOUNDRY_DATA_DIR`, `TOOL_DATA_DIR` and
`FOUNDRY_APP_DIR` (compose would expand or read them differently from the script), and they name the key, not the value.

On the Pi use stage 24, never a raw `docker compose up`: it asks for the snapshot, refuses a clash with the units, runs the
rehearsal as its own project (`foundry-ai-tool-pi-rehearsal`) and checks the result. Same variables as in `test.env`:

```bash
ssh foundry-pi 'MODE=up FOUNDRY_HTTP_PORT=30100 BRIDGE_CONTROL_PORT=31614 BRIDGE_LINK_PORT=31615 DASHBOARD_PORT=3300 \
  FOUNDRY_DATA_DIR=/var/lib/foundry-rehearsal TOOL_DATA_DIR=/var/lib/foundry-ai-tool-rehearsal bash -s' < stage24-with-lib.sh
```

(`stage24-with-lib.sh` is `lib.sh` and `24-compose.sh` joined, as in the stage header.) On a PC or laptop without the Pi's
folders, plain `docker compose --env-file deploy/pi/test.env -f deploy/pi/compose.yml up -d --build --wait` with the two
data folders exported works.

Without Foundry's files (CI, a laptop) add `-f deploy/pi/compose.test.yml`: it swaps Foundry for a stand-in and keeps
gm-browser out unless `--profile gm-browser` is given. `.github/workflows/pi-images.yml` runs exactly that on an ARM
runner.

## Cutover and rollback

`24-compose.sh` takes `MODE=up|down|cutover|rollback`. Run it like the other stages, after the snapshot and the OK.

- `MODE=up` starts a **rehearsal** stack on other ports and its own data folders. On the live ports (any one of them) or the live data folders it is refused until the cutover is supported (Backlog `pi-compose-cutover`).
- `MODE=cutover` is **refused for now**: the nightly backup and the stages that start `foundry.service` do not know the
  stack yet (Backlog `pi-compose-cutover`). The code stays for that item.
- `MODE=rollback` stops every container of the live project and starts the units again: one command, nothing to rebuild.
- `MODE=down` stops the stack and leaves the units as they are.

`deploy/pi/deployed-state.sh` (or `deployed-state.ps1` from the PC) shows which side is running and fails when a
unit and its container both run.

## Checks

- Each container has a health check (`healthcheck.mjs`): Foundry `/api/status`, the bridge control port, the dashboard
  `/api/health`, and for gm-browser the bridge's `link_status` (the module's socket is connected). gm-browser is
  reported but is not part of the gate that decides whether the stack is up: it needs the world, its login and the module.
- `restart: unless-stopped` restarts a container that exits, also after a clean exit. A restart count of 5 or more
  is a crash loop in `deployed-state.sh`.

## Docker on the host

Stage 23 sets `live-restore` in `/etc/docker/daemon.json` (only when that file does not exist), so containers survive a daemon
restart such as a `docker.io` upgrade. Docker also sets the iptables FORWARD policy to DROP (nothing on the Pi forwards
traffic; the containers use host networking) and `/var/lib/docker` sits on the root file system, so the nightly
`dietpi-backup` snapshot includes it (the images are rebuilt by stage 23, nothing in there is needed to restore).

## Image sizes

From the ARM64 `pi-images` run: app 296 MB, foundry 253 MB, gm-browser 981 MB (a build takes about 8 minutes on the runner).
