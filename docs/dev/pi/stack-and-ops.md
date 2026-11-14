---
title: The stack, runners and where things live
description: Board status report, GitHub Actions runners, the stack in containers and where everything lives on the Pi.
---

# The stack, runners and where things live

Part of [PI-SETUP](../PI-SETUP.md).

## Board status report (stage 16)

The Pi reports its own health to the PM board once an hour, because the PC is not always on. Stage 16
(`scripts/pi/remote/16-board-status.sh`) installs `/opt/foundry-ai-tool/status/board-status.sh` and a
systemd timer `foundry-board-status.timer` (minute 07 of every hour, and 5 minutes after boot). The script only reads the Pi and sends one JSON object: up and uptime,
disk free (the disk with Foundry's data), the last nightly backup (the result of
`foundry-backup.service` and the time of the newest restic snapshot, read with `--no-lock`), and
the time of the newest `dietpi-backup` snapshot (`backup.snapshotAt`, from the mtime of its stats
file), whether `foundry.service` itself is active (`foundry.serviceActive`), the clock (`clock.ntpSynced`
and the last measured NTP `clock.offsetMs`, null when systemd-timesyncd does not run), and
Foundry up or down with the Foundry and dnd5e versions from `localhost:30000/api/status`, and
a `deployed` object (the ref from `.tool-ref`, the missing environment variables as `file:NAME`, whether
libicu is present, the compose container state, its health and restart count, `containers` null
while docker.service is stopped; names and states only). No log lines, no world or user names, no host name but `foundry-pi`. The board stores it and shows it on
Today, red when the backup is older than 30 hours or no report came for 3 hours.

- **Token file (the user creates it, once):** `/etc/foundry-ai-tool/board-status.conf`, owner root,
  mode 0600, exactly two lines: `header = "CF-Access-Client-Id: <id>"` and
  `header = "CF-Access-Client-Secret: <secret>"` (the Cloudflare Access service token `pi-status`;
  board side: the PM board README, "Pi status on Today"). The stage refuses without it, refuses any
  other line, and never prints it; curl reads it with `-K`, so the values are not in the process list.
- **Run:** after a `dietpi-backup` snapshot,
  `cat scripts/pi/remote/lib.sh scripts/pi/remote/16-board-status.sh | ssh foundry-pi 'bash -s'`.
  It ends with one report; a board that is not deployed yet (or a wrong token) fails that first report
  with the HTTP code, and the timer stays installed.
- **Check later:** `systemctl list-timers foundry-board-status.timer`, `journalctl -u foundry-board-status -n 5`
  (it prints `sent (HTTP 204)` or the HTTP code).
- Tests: `scripts/pi/board-status.test.mjs` (the script against a local server) and, with
  `PI_STAGE16_CONTAINER=1` (Docker), `scripts/pi/container-test/stage16-scenarios.sh` in the ARM64 container.

## GitHub Actions runners for the PM board (stage 17)

The PM board is rebuilt by GitHub Actions on every vault push, which used up the free hosted minutes
(2026-10-28). Stage 17 (`scripts/pi/remote/17-gh-runner.sh`) puts two self-hosted runners (linux-arm64, pinned
release and sha256) on the Pi: `vault` for `Gnuminator/obsidian-vault` (workflow `board`) and `board` for
`Gnuminator/foundry-ai-tool-pm-board` (workflow `deploy board`). A repo-level runner serves one repo, hence two.

- **Fenced from the game:** the user `ghrunner` (no login, no sudo, no foundry group); each runner's unit allows
  writes only in `/opt/gh-runner/<name>`, cannot see `/etc/foundry-ai-tool`, `/var/lib/foundry*` or `/mnt`, cannot
  list other processes, cannot reach loopback, Tailscale or the LAN (the router stays reachable for DNS and the way
  out), and has 2 GB and a low CPU weight. IPv6 is denied as a whole (`::/0`; the runner reaches GitHub over IPv4).
  The IPv4 nameservers in `/etc/resolv.conf` are allowed along with the router; a nameserver in `127.0.0.0/8`, a Tailscale
  address (`100.64.0.0/10`) or one of the Pi's own addresses cannot be, so the stage stops and names it. The stage
  proves the address rules before it starts anything: a control probe without the rules must reach sshd (otherwise
  the fence cannot be tested and the stage stops), and a probe service with the rules must be refused at sshd on
  loopback and on the Pi's LAN address. If that probe still connects (a kernel without cgroup BPF firewalling), the
  stage turns the gate timer off and stops; runners that already run keep running until they are stopped. A workflow
  on any branch of these repos runs on the Pi, so both repos must stay private (checked 2026-10-28: both are).
- **Gate:** `foundry-ai-tool-gh-runner-gate.timer` (every minute) runs `/opt/gh-runner/gate.sh`. While a play
  session is marked (the newest `session-start`/`session-end` marker over the 3 newest `sessions/<date>.jsonl` of a
  world vault is a start, so a session over midnight counts; a start older than 14 hours is stale) **or a non-GM
  player is connected** (an unmarked night: the newest `user-join`/`user-leave` per user in the 3 newest
  `sessions/<date>.play.jsonl`; a join younger than 14 hours with no later leave counts; the GM and the TV table
  viewer do not; a record with no `isGM` field counts as a player, so the board runner stays stopped when in doubt; a join
  older than the newest `session-end` of that world is ignored, since a Foundry stop or a world switch can end a
  session without a leave) it stops the
  `board` runner when it runs no job. The `vault` runner (it rebuilds the PM board on every vault push) is never held: the
  gate starts it when it is stopped, whatever the state (`GATE_KEEP_UNITS`, tests only, names the kept units). A job is found through the unit's cgroup (a `Runner.Worker` process), and a running job
  is left alone, so it can delay the stop until it ends. Board-repo builds wait on GitHub's side and run when the session ends; vault pushes keep building.
  Nothing marks a session by itself: it relies on `mark-play-session`. If the state cannot
  be read, the board runner stays stopped for up to 14 hours in a row, then the gate lets it run and logs it. The runners are
  not enabled at boot: the gate starts the vault runner within a minute in every state, and the board runner when no session is marked. A rerun that changes a unit
  file does not touch a running runner: stop it (`systemctl stop`) and the gate starts it with the new file.
- **Tokens:** the Cloudflare token stays in the `board` environment secrets on GitHub (the workflow already reads it;
  nothing of it is on the Pi). A runner is registered with a one-hour registration token that
  `scripts/pi/remote/put-runner-token.sh vault|board` (on the PC) pipes from `gh` into
  `/etc/foundry-ai-tool/gh-runner-<name>.reg` (root only) without printing it; the stage deletes the file after
  registering. A runner that is registered needs no token on a rerun.
- **Run:** after a `dietpi-backup` snapshot and both token files,
  `cat scripts/pi/remote/lib.sh scripts/pi/remote/17-gh-runner.sh | ssh foundry-pi 'bash -s'`. It does not touch Foundry
  or any of its services.
- **libicu:** the runner's .NET needs ICU, and GitHub's `config.sh` stops without it (it reports on stdout, not stderr).
  Only when no libicu is in the library cache, the stage refreshes the apt lists (`apt-get update`, as stages 1, 4 and 12
  do), installs the newest `libicuNN` package apt then knows (`libicu72` on Debian 12), says so, and removes nothing. This
  comes before the runner user is created. If registering still fails, the last lines of `config.sh`'s output are
  printed, minus any line that could hold the token.
- **Check later:** `systemctl list-timers foundry-ai-tool-gh-runner-gate.timer`,
  `journalctl -u foundry-ai-tool-gh-runner-gate -n 10`, each repo's Settings > Actions > Runners shows `foundry-pi`.
  To stop everything: `systemctl disable --now foundry-ai-tool-gh-runner-gate.timer` and stop the two runner units.
- Tests: `scripts/pi/gh-runner.test.mjs` (the gate against fake vaults, the stage as text, the allow list against fake `resolv.conf` files); with `PI_STAGE17_CONTAINER=1` (Docker) also `scripts/pi/container-test/stage17-scenarios.sh`, the libicu check and the registration step in the ARM64 container, with no ICU installed and started from a folder the runner user cannot enter (`config.sh` checks `ldd ./bin/...` relative to the cwd).

## The stack in containers (stages 23 and 24)

Backlog `pi-docker-compose`. `deploy/pi/compose.yml` runs Foundry, the bridge, the dashboard and the Assistant GM browser
as containers on the same loopback ports; the systemd units stay installed until the cutover is trusted. Everything about
the images, settings, rehearsal and the checks is in [`deploy/pi/README.md`](../../../deploy/pi/README.md). Two stages do the Pi
side, each only after a `dietpi-backup` snapshot and the user's OK; nothing here is retired yet.

- **Stage 23** (`scripts/pi/remote/23-docker.sh`): Debian 13's own `docker.io`, the compose plugin (`docker-compose`, or
  `docker-compose-v2` where the archive has that name) and `docker-buildx`; enables `docker.service`; writes
  `deploy/pi/.env` in the deployed checkout (`/opt/foundry-ai-tool/app`: the foundry user's ids, the tailnet name and the player
  vaults folder from stage 21); builds the three images. Starts nothing. `DRY_RUN=1` prints the plan, `SKIP_BUILD=1` skips the
  build. Run it again after every stage 5 build (the checkout, and its `.env`, is replaced).
- **Stage 24** (`scripts/pi/remote/24-compose.sh`, `MODE=status|up|down|rollback`): `up` and `down` start and stop the stack
  for a rehearsal (`up` is refused next to a running or enabled unit on the live ports or data folders; a rehearsal on other
  ports is its own compose project and never touches the live containers); `rollback` is the one command back (every container
  of the live project stopped, found by label, then the units enabled and started in order). `status` is read-only. Containers
  are always found by label, and a Docker daemon that does not answer makes the stage refuse. **`MODE=cutover`** (Backlog
  `pi-compose-cutover`) switches the live stack to containers. It is two sittings: a rehearsal (snapshot, stage 23, `MODE=up`
  on the `test.env` ports, `MODE=down`), then the cutover, at least 7 days before session 0, otherwise after G2 (D-142): a snapshot
  (quiet table), stage 6 again (the cutover refuses while the installed nightly script does not know the containers), `MODE=cutover DRY_RUN=1`,
  `MODE=cutover`, a nightly backup run by hand, `MODE=rollback` at any time. The exact steps are in `deploy/pi/README.md`, "Cutover
  and rollback".
- **After a cutover every stage that would start, restart or enable `foundry.service`, the bridge, the dashboard or the Assistant
  GM refuses** (`refuse_when_cut_over` in `lib.sh`: 3, 5, 7, 11, 12, 13, 14, 19, 21, 25, 27, 28, 30, `gm-script`, `kit-session`,
  `switch-world`, `set-dashboard-access`), also with `FORCE=1`, also when only a stopped container exists, and when the Docker
  daemon does not answer. The Discord bot stays a unit, so its stages (8, 26, `set-discord-token`) are not guarded. Go back with
  `MODE=rollback` first. `scripts/pi/cutover-guard.test.mjs` fails for a new stage that starts a unit without the guard.
- The nightly backup (stage 6) stops and starts the Foundry **container** when the stack runs as containers, verifies it is stopped
  before restic copies the worlds, and reports an error when the daemon is silent and `foundry.service` is not running either. Run
  stage 6 again before the cutover so the Pi has the new script; `MODE=cutover` refuses until it does.
- Tests: `scripts/pi/docker-compose.test.mjs` (both stages as text; with `PI_STAGE23_CONTAINER=1` the scenario scripts
  `scripts/pi/container-test/stage23-scenarios.sh` and `stage24-scenarios.sh` in an ARM64 container). The scenarios use stand-ins
  for apt, docker, systemctl and ss, so they also run in Git Bash. The guard in the other stages has `scripts/pi/cutover-guard.test.mjs`
  and, with `PI_CUTOVER_CONTAINER=1`, `cutover-guard-container.test.mjs` (`container-test/cutover-guard-scenarios.sh`: each guarded
  stage refuses next to a running or stopped container, a silent daemon and `FORCE=1`); CI runs it on ARM.

## Where things live on the Pi

| What                                                           | Where                                                                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundry program                                                | `/opt/foundry`                                                                                                                              |
| Foundry data (worlds, modules, assets)                         | `/var/lib/foundry`                                                                                                                          |
| Node.js                                                        | `/opt/node24`                                                                                                                               |
| The tool (release builds)                                      | `/opt/foundry-ai-tool`                                                                                                                      |
| Settings and secrets for the tool                              | `/etc/foundry-ai-tool/.env` (readable by root and the service only)                                                                         |
| The tool's storage (bridge vault)                              | `/var/lib/foundry-ai-tool`                                                                                                                  |
| Backups                                                        | restic repository `/var/lib/foundry-backup/restic` (the PC copy: `E:\PiBackup\restic`)                                                      |
| Recorder bot                                                   | `/opt/foundry-ai-tool/discord-bot` (service `foundry-ai-tool-discord-bot`)                                                                  |
| Recordings (until this PC has copied them, then 7 more days)   | `/var/lib/foundry-ai-tool/recordings`                                                                                                       |
| GM vault (Syncthing shares it)                                 | `/var/lib/foundry-ai-tool/obsidian/gm`                                                                                                      |
| Player vaults (one folder per player, Send Only; stage 21)     | `/var/lib/foundry-ai-tool/obsidian/players/<Player name>`                                                                                   |
| Space check status (hourly)                                    | `/var/lib/foundry-ai-tool/space/status.json`                                                                                                |
| Board status report (stage 16): script, token file, timer      | `/opt/foundry-ai-tool/status/board-status.sh`, `/etc/foundry-ai-tool/board-status.conf`, `foundry-board-status.timer`                       |
| GitHub runners for the PM board (stage 17): runners, gate      | `/opt/gh-runner/{vault,board}`, `/opt/gh-runner/gate.sh`, `foundry-ai-tool-gh-runner-{vault,board}.service`, `-gate.timer`                  |
| Game-night watch (stage 29): files, settings, service          | `/opt/foundry-ai-tool/gamenight-watch`, `/etc/foundry-ai-tool/gamenight-watch.env`, `foundry-ai-tool-gamenight-watch.service`               |
| Player connector (stage 30): login table, switch file          | `/etc/foundry-ai-tool/player-connector.json` (foundry, 0600), `/etc/foundry-ai-tool/player-connector.env`                                   |
| Player connector: unit drop-ins, table waiting to be installed | `/etc/systemd/system/foundry-ai-tool-{dashboard,bridge}.service.d/player-connector.conf`, `/root/player-connector.json.new`                 |
| Copy of the allowed hosts before stage 30 changed them         | `/etc/foundry-ai-tool/dashboard-access.env.before-player-connector`                                                                         |
| Crash guard (stage 32): drop-ins, alert unit, clock timer      | `/etc/systemd/system/<unit>.service.d/10-crash-guard.conf`, `foundry-ai-tool-alert@.service`, `foundry-ai-tool-clock-check.{service,timer}` |
| Crash guard: scripts, clock state                              | `/opt/foundry-ai-tool/crash-guard`, `/var/lib/foundry-ai-tool-crash-guard`                                                                  |
| When this PC last copied the backups (restic, snapshot)        | `/var/lib/foundry-backup-pulls/<kind>.json`                                                                                                 |
| A dnd5e trial (the old version, world copies; stage 14)        | `/var/lib/foundry-import/system-trial`                                                                                                      |

## Sources

Checked on 2026-10-04 (details in the vault research note for the Pi setup):
[DietPi hardware list](https://dietpi.com/docs/hardware/),
[DietPi images](https://dietpi.com/downloads/images/) (the Orange Pi 5 Pro image and its `.sha256`),
[DietPi `dietpi.txt`](https://github.com/MichaIng/DietPi/blob/master/dietpi.txt),
[Foundry requirements](https://foundryvtt.com/article/requirements/) (Node 24 for Foundry 14),
[Foundry installation](https://foundryvtt.com/article/installation/),
[Node.js downloads](https://nodejs.org/en/download),
[Tailscale on Linux](https://tailscale.com/kb/1031/install-linux),
[Cloudflare Tunnel downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/),
[Cloudflare Access one-time PIN](https://developers.cloudflare.com/cloudflare-one/identity/one-time-pin/),
[Debian chromium package](https://packages.debian.org/trixie/chromium).
