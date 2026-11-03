# The Pi stack in containers

`compose.yml` runs Foundry, the bridge, the co-GM dashboard and the Assistant GM browser as containers on the
Orange Pi, next to the systemd units that run them today. Nothing here changes the Pi by itself: the stage scripts
`scripts/pi/remote/22-docker.sh` (install Docker, build the images) and `scripts/pi/remote/23-compose.sh` do that,
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

| Variable                     | Default                    | Meaning                                                                  |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| `FOUNDRY_UID`, `FOUNDRY_GID` | required                   | the foundry user's ids; every container runs as it                       |
| `FOUNDRY_HTTP_PORT`          | 30000                      | Foundry's port                                                           |
| `BRIDGE_CONTROL_PORT`        | 31414                      | the bridge control port (`MCP_CONTROL_PORT`)                             |
| `BRIDGE_LINK_PORT`           | 31415                      | the Foundry link (the bridge reads it as `FOUNDRY_PORT`)                 |
| `DASHBOARD_PORT`             | 3000                       | the dashboard                                                            |
| `DASHBOARD_ALLOWED_HOSTS`    | empty                      | the Pi's tailnet name                                                    |
| `FOUNDRY_APP_DIR`            | `/opt/foundry`             | Foundry's program files                                                  |
| `FOUNDRY_DATA_DIR`           | `/var/lib/foundry`         | Foundry's data                                                           |
| `TOOL_DATA_DIR`              | `/var/lib/foundry-ai-tool` | vault, dashboard state, browser profile; mounted at the same path inside |
| `TOOL_ETC_DIR`               | `/etc/foundry-ai-tool`     | the four env files (all optional to compose)                             |

An env file must not set the ports or the folder variables above: `environment:` in the compose file wins over it.

## Rehearse beside the live stack

Use other ports and your own data folders, never the live `FOUNDRY_DATA_DIR` (two Foundrys on one data folder
corrupt it). `test.env` holds the rehearsal ports 30100, 31614, 31615 and 3300 (D-119).

```bash
export FOUNDRY_UID=$(id -u foundry) FOUNDRY_GID=$(id -g foundry)
export FOUNDRY_DATA_DIR=/var/lib/foundry-rehearsal TOOL_DATA_DIR=/var/lib/foundry-ai-tool-rehearsal
docker compose --env-file deploy/pi/test.env -f deploy/pi/compose.yml up -d --build --wait
docker compose --env-file deploy/pi/test.env -f deploy/pi/compose.yml down
```

Without Foundry's files (CI, a laptop) add `-f deploy/pi/compose.test.yml`: it swaps Foundry for a stand-in and keeps
gm-browser out unless `--profile gm-browser` is given. `.github/workflows/pi-images.yml` runs exactly that on an ARM
runner.

## Cutover and rollback

`23-compose.sh` takes `MODE=up|down|cutover|rollback`. Run it like the other stages, after the snapshot and the OK.

- `MODE=up` starts the containers (use rehearsal ports while the units run).
- `MODE=cutover` stops and disables the systemd units (they stay installed) and starts the stack on the live ports.
- `MODE=rollback` stops the stack and starts the units again: one command, nothing to rebuild.
- `MODE=down` stops the stack and leaves the units as they are.

`deploy/pi/deployed-state.sh` (or `deployed-state.ps1` from the PC) shows which side is running and fails when a
unit and its container both run.

## Checks

- Each container has a health check (`healthcheck.mjs`): Foundry `/api/status`, the bridge control port, the dashboard
  `/api/health`, and for gm-browser a process check for now (the bridge-link check is the item
  `assistant-gm-link-check`).
- `restart: unless-stopped` restarts a container that exits, also after a clean exit. A restart count of 5 or more
  is a crash loop in `deployed-state.sh`.

## Image sizes

To be filled in from the first `pi-images` run (the job summary lists them): app ?, gm-browser ?, foundry ?.
