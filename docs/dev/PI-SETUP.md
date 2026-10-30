---
title: Orange Pi setup
description: Bring up the Orange Pi 5 Pro from scratch as the home server for Foundry, the tool, backups and the Discord bot, with as much automation as possible.
---

# Orange Pi setup

The Orange Pi 5 Pro (16 GB) becomes the always-on home server: Foundry VTT itself, the bridge, the
dashboard, the Discord bot, backups and vault sync. Decisions: vault notes D-068 (the Pi),
D-075 (how players reach it).

How the work is split:

- **Part A, you (about 30 minutes, today):** prepare a microSD card on this PC, plug the Pi in, run
  one script. After that this PC can reach the Pi over SSH. Checked against DietPi's current image
  on 2026-10-04.
- **Part B, Claude (over SSH from this PC):** the system, Node.js, Foundry, private admin access,
  the tool, backups and vault sync, in stages. Claude stops before each stage and at the few steps
  only you can do (licence key, logins in your browser).
- **Part C: players and the GM from outside** through Cloudflare (Foundry and the dashboard live since 2026-10-14). Your steps:
  [Remote access, Part C](REMOTE-ACCESS.md#part-c-players-and-the-gm-reach-the-orange-pi-through-cloudflare);
  Claude's side is stage 12, in the stage table and in Part C below.

Day-to-day development and testing stay on this PC's test server; the Pi only runs released builds
and the campaign world.

## What you need

- The Orange Pi 5 Pro and its official USB-C power supply (5 V, 5 A).
- A microSD card, 32 GB or larger (A2 class if you have one). An NVMe SSD later is strongly
  recommended before real play: see "Moving to NVMe" below.
- An Ethernet cable to the router.
- A card reader on this PC.
- Fallback only: a monitor with an HDMI cable and a USB keyboard, if the Pi cannot be found on the
  network.

## On your PC

| What                                                         | When            | Check                                                                                                 |
| ------------------------------------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------- |
| PowerShell 7                                                 | Part A          | `$PSVersionTable.PSVersion` shows 7 or newer (`winget install Microsoft.PowerShell`)                  |
| The Windows OpenSSH client                                   | Part A          | `ssh -V` answers (Settings, Optional features, "OpenSSH Client")                                      |
| [Raspberry Pi Imager](https://www.raspberrypi.com/software/) | Part A          | writes the image to the card and checks it (`winget install RaspberryPiFoundation.RaspberryPiImager`) |
| [Tailscale](https://tailscale.com/download)                  | Part B, stage 4 | you log in once; this PC then reaches the Pi privately                                                |
| Claude Desktop, pointed at the Pi's bridge                   | Part B, stage 5 | Claude changes its five entries with your OK (see stage 5)                                            |
| [Syncthing](https://syncthing.net/downloads/)                | Part B, stage 7 | only if you want the vaults synced to this PC                                                         |

The repo stays where it is; the scripts below run from the repo folder.

## Part A: you

### 1. Download and check the image

In PowerShell 7, from the repo folder:

```powershell
.\scripts\pi\prepare-sd.ps1 -Download
```

It downloads DietPi for the Orange Pi 5 Pro (Debian 13 "Trixie", about 190 MB) into
`Downloads\foundry-pi\` and checks its SHA-256 checksum against the one DietPi publishes. Why
DietPi: it has a dedicated image for this board, and its card carries a small settings partition that
Windows can write, so the first boot is configured without a monitor.

### 2. Write the image to the card

Open Raspberry Pi Imager. **Choose Device:** "No filtering". **Choose OS:** scroll down to "Use
custom" and pick the downloaded `.img.xz` file. **Choose Storage:** the microSD card (double-check
it: Imager erases it). If it asks about OS customisation, click **No** (the script below does the
settings). It writes the card, checks it, and ejects it.

Not balenaEtcher: on 2026-10-04 its check step crashed twice on Windows ("The writer process ended
unexpectedly") although the card was fine.

### 3. Put the settings on the card

When Imager is done, take the card out and put it back in. Windows shows a small drive named
**DIETPISETUP**. If Windows offers to format any drive, click **Cancel**. Then run:

```powershell
.\scripts\pi\prepare-sd.ps1 -Configure
```

It writes the first-boot settings into `dietpi.txt` on that drive:

- hostname `foundry-pi`, time zone `Europe/Copenhagen`, network by DHCP over Ethernet, Wi-Fi off;
- the OpenSSH server with a new SSH key made for this PC (`~\.ssh\foundry_pi`), so Claude can log in
  without a password;
- a strong random root password, saved on this PC in `~\.foundry-pi\root-password.txt` (only needed at
  a monitor and keyboard);
- the Avahi service, so `foundry-pi.local` can be found on the network;
- nothing else: every other service is installed in Part B, one by one, after your OK.

Then eject the card safely (right-click the drive, **Eject**).

### 4. Start the Pi

Put the card in the Pi, connect Ethernet, then power. The first boot updates and configures itself; it
takes about 5 to 15 minutes. The Pi has no screen output you need to watch.

### 5. Find the Pi and hand over

```powershell
.\scripts\pi\find-pi.ps1
```

It looks for `foundry-pi.local`, and if that does not answer, scans your home network for the Pi and
checks it with the SSH key. When it finds the Pi, it adds a `foundry-pi` entry to your SSH settings,
so `ssh foundry-pi` works. It keeps trying for up to 20 minutes while the first boot finishes.

Then tell Claude: **"The Pi is up."**

Then give the Pi a fixed address in your router, so it keeps the same address after restarts: see
"Your UniFi gateway" below.

If the script cannot find the Pi after 20 minutes: plug in the monitor and keyboard, log in as `root`
with the password from `~\.foundry-pi\root-password.txt`, and run `hostname -I` to see its address.
Then run `.\scripts\pi\find-pi.ps1 -Address <that address>`.

## Part B: Claude

Claude works over `ssh foundry-pi` and pauses before each stage. Where you are needed, it says so.
Stages 1 to 4 are scripts in `scripts/pi/remote/` (Claude runs `lib.sh` plus the stage over SSH);
each one checks what is already there, so running it again is safe. They were tested in an ARM64
Debian 13 container on 2026-10-04, including the real Foundry 14.368 build starting on Node 24.
Each stage ends with a check Claude shows you (a service running, a page answering, a backup
listed).

**Game-night guards (`lib.sh`, r37 S1 to S5):**

- **A rerun restarts nothing that did not change.** `enable_unit` restarts a running service only when its
  own unit file (or a settings file it was given) changed in that run, or with `RESTART_UNITS=1` in front of
  `bash`; a stopped service is started.
- **Every stage refuses without a `dietpi-backup` snapshot from today** (the nightly 01:25 one counts; the check
  reads `/mnt/dietpi-backup/.dietpi-backup_stats`). Take one with `/boot/dietpi/dietpi-backup 1`. Stages 1 to 4 on
  a brand-new Pi need `NO_SNAPSHOT=1`, as there is no snapshot yet (`FORCE=1` does not skip this check; the check
  reads the last "Backup completed" line, so a started or cancelled run does not count).
- **A stage that stops or restarts a service refuses while players are online** (Foundry's `/api/status`; the
  Assistant GM browser counts as one user while it runs, an unreadable answer counts as "not safe") **or a Discord
  recording runs** (a session folder in `recordings` whose `raw/` has no `session.json`, `convert-report.json` or
  `convert-failed.json` and was written to in the last 10 minutes, or, while the bot runs, changed since the bot
  last started: the bot writes nothing while nobody speaks). Put `FORCE=1` in front of `bash` on the ssh line to go on anyway: `... | ssh foundry-pi 'FORCE=1 bash -s'`.
- **Stages 5 and 12 warn when the dashboard player/GM split is off** (`dashboard-access.env` has neither
  `GM_DASHBOARD_TOKEN` nor `GM_EMAILS`): everyone who reaches port 3000 is then the GM.
- **Stage 2 pins Node** (`NODE_VERSION`, default `v24.21.0`; change the pin in the script to move). Stages 2 and 3
  unpack the new Node or Foundry next to the old one and swap with two renames (the old one stays as `.prev`), so
  a failure never leaves an empty `/opt/node24` or `/opt/foundry`.
- **Stage 8 keeps the recordings out of `dietpi-backup`** (one line in `/boot/dietpi/.dietpi-backup_inc_exc`;
  snapshots taken earlier keep them until they rotate out).

| Stage               | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Needs you                                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Health check     | Updates, disk, memory, temperature, clock and time zone; a `foundry` system user and the folders below (`scripts/pi/remote/1-health.sh`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | no                                                                                                                                                                                                                                 |
| 2. Node.js          | Node 24 LTS (Foundry 14 requires it) for ARM64 from nodejs.org, checksum-checked against `SHASUMS256.txt`, in `/opt/node24` (`2-node.sh`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | no                                                                                                                                                                                                                                 |
| 3. Foundry          | Installed as a service on port 30000, data in `/var/lib/foundry`, reachable at `http://foundry-pi.local:30000` from home; started with `--noupnp`, so Foundry never asks the router to open a port (`3-foundry.sh`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **yes:** download the **Linux/Node.js** build from your foundryvtt.com account on this PC (the link lasts 5 minutes; Claude copies the file over), then enter the licence key and an admin password in your browser on first start |
| 4. Tailscale        | Private admin access: SSH and the bridge from this PC, also when you are away from home. For you only, not the players (D-075). From Tailscale's own apt repository (`4-tailscale.sh`). Tailscale DNS is off on the Pi, so names come from the router (with it on, a DHCP lease renewal left the Pi with no public lookups)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **yes:** open the login link Claude shows, and install Tailscale on this PC with the same account                                                                                                                                  |
| 5. The tool         | Bridge and dashboard as services, built on the Pi from a release tag (`5-tool.sh`, default the newest `vX.Y.Z` tag, never main, see [RELEASING](RELEASING.md); `TOOL_REF` picks another tag or commit; the build drops the dev packages when the ref lists `playwright-core` as a dependency, and a rerun with the same ref builds again once if an earlier run kept them; before anything stops it loads modules of the bridge, the dashboard (app, config, AI client) and the shared package from the pruned build, so a runtime package the prune took away stops the stage with the services untouched), the module copied into Foundry from the same build; a Chromium browser without a screen, logged into Foundry as a dedicated Assistant GM user (role Assistant, so the human GM stays the primary GM) and set as the bridge's user, so the tool works when no human GM is online; everything on loopback, the control port and the dashboard shared with the tailnet only (Tailscale serve). `5-check-world.sh` proves the chain in a throwaway world `pi-check`                                          | **yes:** OK the stage; OK Claude switching the five Claude Desktop entries on this PC to the Pi (Claude Desktop restarts, which cuts Claude Code sessions in the app)                                                              |
| 6. Backups          | Nightly restic backup at 04:30 on the Pi (`6-backup.sh`): `/var/lib/foundry` (worlds, modules), the tool's storage and `/etc/foundry-ai-tool` (secrets), without logs, the browser profile and recordings; Foundry stops for a minute or two while it runs, but not while players are online: it looks again every 30 minutes (six times), then skips the night with an ERROR line in `journalctl -u foundry-backup` and a marker file, and the next night backs up anyway after the same waits (the Assistant GM and Kit GM browsers are not counted once they have joined); 7 daily kept on the Pi. This PC copies it every day into `E:\PiBackup\restic` (`pull-restic.ps1`): 14 daily, 8 weekly, 12 monthly, plus a monthly test restore. Also installs `record-pull.sh`, which the PC's two pull scripts call after each good copy so the Discord bot can DM you when no copy arrived for 3 days (see "Stale backup copies")                                                                                                                                                                                     | **yes:** store the PC repository's password (`%APPDATA%\foundry-ai-tool\restic-pc.pass`, made on the first copy) in your password manager: without it the copies cannot be read                                                    |
| 7. Vault sync       | Syncthing (Debian's, as its own service `foundry-ai-tool-syncthing`, files in `/var/lib/foundry-ai-tool/syncthing`) shares the GM vault with the GM's PC (and this PC, for checking) (`7-vault.sh`). The bridge writes the vault to `/var/lib/foundry-ai-tool/obsidian/gm` (`bridge.env`: `FOUNDRY_AI_OBSIDIAN_DIR`, `FOUNDRY_AI_OPEN_BASE`, `FOUNDRY_AI_FOUNDRY_URL`); relays on, UPnP off, GUI on loopback. The Foundry mirror switch stays off (a GM decision per world). The player vault waits for O7 (D-091)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **yes:** on each receiving PC run `scripts/pi/setup-syncthing-pc.ps1` (or accept the Pi in the Syncthing GUI), then give Claude that PC's device ID                                                                                |
| 8. Discord bot      | The recorder bot as a service (`8-recorder.sh`: `foundry-ai-tool-discord-bot`, runs as `foundry`, from the stage 5 build, so it shares the tool version; run it again after a new stage 5 build), recordings in `/var/lib/foundry-ai-tool/recordings`; this PC copies finished recordings over Tailscale for transcription. The service stays off until the token is in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **yes:** run `scripts/pi/set-discord-token.ps1` on this PC and paste the bot token from the Discord developer page (not shown on screen; Claude never sees it); it starts the bot                                                  |
| 9. Command log      | Every SSH login with the PC's key goes through a small logger (`9-ssh-log.sh`: a `command=` prefix on the key line in `/root/.ssh/authorized_keys`, `sshd_config` untouched): one line per command in `/var/lib/foundry-ai-tool/ssh-log/ssh-commands.log`, plus a copy of every stage script; root only, 12 weeks kept; the token script is logged by name only. A logging error never blocks the command. A 5-minute safety timer restores the old key file unless a new connection confirms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **yes:** your OK (an SSH change), and default permission mode while it runs                                                                                                                                                        |
| 10. Space check     | An hourly storage check (`10-space-check.sh`: `foundry-space-check.timer`, the checker in `/opt/foundry-ai-tool/space`) of every disk the backups, snapshots, the vault sync and the recordings use, written to `/var/lib/foundry-ai-tool/space/status.json` (below 20 % free is low, below 5 % is critical) and as a warning line in the journal. The nightly restic backup (stage 6) runs the check first: below 20 % it still runs, at critical it is skipped. `UNDO=1` removes it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **yes:** your OK (a new service and timer); then run stage 6 again so the backup gets its pre-check                                                                                                                                |
| 11. World           | `11-world.sh` installs the bundle `push-world.ps1` built on this PC, after checking the tar and every checksum: the campaign world, its private modules and image folders. An existing campaign world is kept unless `REPLACE_WORLD=1`; a test copy `strahd-kit` is reset every time; old copies go to `/var/lib/foundry-import/prev-<time>`, never deleted. Each world gets a generated GM password (`/etc/foundry-ai-tool/world-<id>.env`) and is provisioned like stage 5. A Plan B push-back keeps the Pi's GM password and needs `REPLACE_WORLD=1 KIT_WORLD=` ([Plan B](PLAN-B.md#after-the-night)). See "Licensed content"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **yes:** your OK (Foundry stops for a few minutes), after a `dietpi-backup 1` snapshot                                                                                                                                             |
| 12. Tunnel          | Part C (D-075): Cloudflare Tunnel, so players reach Foundry and the GM the dashboard through Cloudflare Access with no router port open (`12-tunnel.sh`). `cloudflared` from Cloudflare's signed apt repository (key pinned), service `foundry-ai-tool-cloudflared` in token mode: a root-only token file read through systemd `LoadCredential`, never an argument or environment variable; no token, no start. `FOUNDRY_PUBLIC_HOST=play.<domain>` sets Foundry's `hostname`, `proxySSL`, `proxyPort` 443. No firewall, SSH, network or Tailscale change. Stops first, before it installs anything, while Foundry has no administrator password, or any world has a Gamemaster or Assistant GM with no password or no Gamemaster at all (a never-launched world counts); `gm-passwords.sh` runs that read-only check on its own, again after adding worlds or GM users. It also checks that the bridge's control port 31414 answers on loopback and nothing listens beyond it (the `mcp` TCP route of D-095 reaches it through the tunnel, behind its own Access application, see [Remote access](REMOTE-ACCESS.md)) | **yes:** your OK and a snapshot; then run `set-tunnel-token.sh` yourself over SSH                                                                                                                                                  |
| 13. Player creation | D-112, D-113: players make characters (level 1, levelled to 3) in Actor Studio at session 0 (`13-player-creation.sh`). Installs our Actor Studio fork build (`2.10.5-aitool.4`) from its GitHub release, checked against a pinned sha256, and sets the world settings creation needs (Player and Trusted Player may create actors; equipment selection on, from the Player's Handbook pack). See "Player character creation"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **yes:** your OK (Foundry stops for a few minutes), after a `dietpi-backup 1` snapshot                                                                                                                                             |
| 14. System trial    | D-098: a new dnd5e version runs on the kit world `strahd-kit` first (`14-system-trial.sh`, `MODE=trial`, then `switch` or `rollback`). The release zip is pinned by sha256; the old version and a copy of every world are kept until the trial ends. While a trial is open, stages 5-check-world, 11 and 13 refuse to run. See "System trial (stage 14)"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **yes:** your OK for each mode (Foundry stops for a minute or two), after a `dietpi-backup 1` snapshot; never on a game-night day                                                                                                  |
| 15. SSH keys only   | D-123, before Part C goes live (`15-ssh-keys-only.sh`): a drop-in `/etc/ssh/sshd_config.d/00-foundry-keys-only.conf` with `PasswordAuthentication no`, `KbdInteractiveAuthentication no` and `PermitRootLogin prohibit-password`, so SSH takes a key and never a password, root included. Refuses unless root has a valid key, sshd takes keys from it, the main config includes the drop-in folder and no `Match` block sets a login value; `sshd -t` after the write and `sshd -T` (root from three addresses) before the reload, and either one failing rolls the drop-in back; a 5-minute safety timer, armed first, removes the drop-in (and starts ssh if it is down) unless a new key-only connection confirms; then a reload, not a restart (open sessions stay up), and a `live:` check of what the running sshd offers. **The console login with the root password still works** (a screen and keyboard on the Pi): the way back in if a key is ever lost. `UNDO=1` removes the drop-in. See "SSH keys only (stage 15)"                                                                                     | **yes:** your OK (an SSH change), after a `dietpi-backup 1` snapshot, in default permission mode, never on a game-night day                                                                                                        |

Stage 5 in more detail, because it changes how Claude Desktop reaches the game: each entry in
`%APPDATA%\Claude\claude_desktop_config.json` gets `MCP_CONTROL_HOST` set to the Pi's Tailscale name
and `MCP_NO_SPAWN` set to `1` (see [Deployment](DEPLOYMENT.md#pointing-claude-desktop-at-a-bridge-that-runs-elsewhere)).
The bridge's control port has no login of its own (vault idea I-023), so the bridge and the
dashboard listen on loopback only, and `tailscale serve` shares port 31414 and the dashboard
(`http://<the Pi's Tailscale name>:3000`) with the tailnet, never with the home network or the
internet. The GM reaches the dashboard through Part C (Cloudflare Access), not Tailscale. The
Foundry module's "bridge user" setting names the Assistant GM user, so the GM's own browser never
tries to run the bridge.

The Assistant GM browser (`assistant-gm.mjs`, service `foundry-ai-tool-gm-browser`) runs as the
`foundry` user with Foundry's "no canvas" setting, which saves the Pi's CPU (the bridge reads
documents; only panning and measuring fall back) and at low priority (`Nice=10`, `CPUWeight=20`), so
it never competes with Foundry's main thread. It reads its user name and password from
`/etc/foundry-ai-tool/assistant-gm.env` (root only). For the throwaway check world
`5-check-world.sh` generates that password and creates the user, so nobody types it; Foundry
launches that world by itself (`options.json`), so no admin password is needed. For the Strahd
world the GM creates the user (role Assistant) and you paste its password into that file. Logs:
`journalctl -u foundry-ai-tool-bridge` (and `-dashboard`, `-gm-browser`). A new build keeps the
previous one in `/opt/foundry-ai-tool/app.prev` for a quick rollback.

No firewall is set up on the Pi: nothing on it is reachable from the internet (no router ports are
opened, Foundry asks for none, and Tailscale and the Cloudflare tunnel both dial out), and on the
home network only Foundry, SSH, the dashboard and Syncthing answer (Syncthing on port 22000: only
devices you have added can connect).

Rules Claude follows on the Pi: never types passwords, licence keys or tokens (you paste them where
asked); never opens anything to the internet before Part C; the campaign world is never used for
tests.

Safety rules (you, 2026-10-04), so a mistake can never leave the Pi unusable:

- **Read-only commands freely; changes only from the stage scripts** in `scripts/pi/remote/`, each
  after your OK. Any other change is shown to you first and runs only after your OK.
- **These need your explicit OK every time, never bundled:** deleting outside the tool's own folders,
  users and groups, disks and partitions, the bootloader, removing packages, firewall, SSH and network
  settings, reboots.
- **A mechanical guard** (`.claude/hooks/guard-remote-commands.mjs`) checks every command Claude sends
  to the Pi, including the scripts it feeds in: it blocks what could wreck the system (deleting `/` or
  a system folder, formatting or overwriting a disk, removing root) and makes Claude Code ask you
  about the rest of the list above. In a session that runs in bypass or auto permission mode it
  blocks those too, because an approval prompt there would be answered without you: for such a
  step, switch the session to the default permission mode and confirm the prompt yourself.
- **Snapshots:** a full system snapshot (`dietpi-backup`, three kept in `/mnt/dietpi-backup`) is
  taken nightly and before every stage. To roll back: `dietpi-backup -1` (needs your OK). Your PC
  also pulls copies (next section), so a dead SD card loses nothing.

## Snapshots on this PC

A scheduled task on this PC, "Foundry Pi snapshot pull", copies the Pi's newest snapshot to
`E:\PiBackup\snapshots\pi-snapshot-<date>_<time>.tar.zst` every day at 12:00 and 10 minutes after
you log on (`scripts/pi/pull-snapshot.ps1`; set up once with `scripts/pi/register-snapshot-task.ps1`,
removed with `-Remove`). It only reads on the Pi: the Pi packs the snapshot with `tar` and `zstd`
and sends it over SSH, so Linux owners, permissions and links survive on Windows. It skips while
`dietpi-backup` runs, throws a copy away if the snapshot changed during it, and test-reads every
archive before keeping it. It keeps the newest 14 plus one per week for 8 weeks, and logs to
`E:\PiBackup\logs\` (`last-success.txt` shows the last good copy; a log line warns after 3 days
without one). About 425 MB per copy on 2026-10-04.

The archives hold secrets (the Foundry licence, `/etc/shadow`, the Tailscale and SSH keys): a cloud
copy of this folder must be encrypted on your side (restic, or the cloud tool's own client-side
encryption).

To restore after a reflash (each step with your OK): flash DietPi and run Part A, copy the archive
to the Pi, unpack it into `/mnt/dietpi-backup` (`zstd -dc <archive> | tar -xpf - -C
/mnt/dietpi-backup`), then run `dietpi-backup -1`.

## Restic copies on this PC

The Pi's nightly restic backup (stage 6) is a versioned copy of Foundry's data, so one world or one
file can come back without restoring the whole system. A second scheduled task, "Foundry Pi restic
copy", copies every new Pi snapshot into `E:\PiBackup\restic` every day at 12:30 and 15 minutes
after you log on (`scripts/pi/pull-restic.ps1`; set up once with
`scripts/pi/register-restic-task.ps1`, removed with `-Remove`). It only reads on the Pi (restic over
SFTP with this PC's SSH key). It keeps 14 daily, 8 weekly and 12 monthly snapshots, once a month
reads 10 % of the data and restores the newest snapshot's worlds into a temporary folder to prove the
copies work, and logs to `E:\PiBackup\logs\restic-<month>.log`. It needs restic on this PC
(`winget install restic.restic`).

Two password files, both in `%APPDATA%\foundry-ai-tool` and readable by you only: `restic-pi.pass`
(the Pi repository's password, fetched from the Pi the first time) and `restic-pc.pass` (this PC
repository's password, generated the first time). **Put `restic-pc.pass` into your password
manager.** Without it the copies cannot be read, for example after this PC is rebuilt.

List and restore (PowerShell; the folder names in the restore are the paths on the Pi):

```powershell
$env:RESTIC_REPOSITORY = 'E:\PiBackup\restic'
$env:RESTIC_PASSWORD_FILE = "$env:APPDATA\foundry-ai-tool\restic-pc.pass"
restic snapshots                                   # what is there
restic ls latest /var/lib/foundry/Data/worlds      # worlds in the newest snapshot
# One world, into a scratch folder (inspect it, then copy it over the live one yourself):
restic restore latest --target E:\Restore --include /var/lib/foundry/Data/worlds/<world-id>
# One file from an older snapshot:
restic restore <snapshot-id> --target E:\Restore --include /etc/foundry-ai-tool/<file>
```

If the Pi itself is down on game night, these copies are what [Plan B](PLAN-B.md) runs Foundry from on
this PC.

Copy a restored world to the Pi only with Foundry stopped, and keep the owner `foundry:foundry`
(`chown -R foundry:foundry` on the world folder); both steps need your OK under the Pi safety rule.

## Game-night watch (I-145)

`scripts/gamenight-watch.mjs` runs on this PC (nothing is installed on the Pi). Every minute it calls
Foundry's `/api/status` and posts to a Discord channel when Foundry does not answer, answers slowly, or
is back. One message when it goes down or slow, one when it recovers; a single miss or slow answer
posts nothing (defaults: 2 misses in a row for "down", 3 slow answers in a row for "slow", over 3 s;
2 good answers in a row for "back").

```powershell
node scripts/gamenight-watch.mjs --url http://<pi-address>:30000            # dry run: log only
node scripts/gamenight-watch.mjs --url http://<pi-address>:30000 --post     # post to Discord
```

Posting is opt-in (`--post`). It uses the bot token already in `%APPDATA%\foundry-ai-tool\discord-bot.env`
(never printed) plus `GAMENIGHT_WATCH_CHANNEL_ID=<channel>` in the same file, and optionally
`GAMENIGHT_WATCH_MENTION_IDS=<your id>,<GM id>` to ping you both. The bot must be in that server and
allowed to post in the channel. Tune with `--interval`, `--slow-ms`, `--timeout-ms`, `--fail`, `--slow`,
`--recover`. For a test, point `--url` at the test server (`http://localhost:30001`) and stop it with
`scripts/test-env/stop.ps1 -Only foundry`.

The message includes the Foundry address (without any user name or password). A message that Discord
refuses is kept and tried again at every check, so a short Discord outage does not lose the "down"
message; a late message says when the problem was noticed. With `--post` the watch first asks Discord
whether the bot can see the channel and stops with an error if not. Foundry counts as up only when
`/api/status` answers 200 with a running world (`active: true`); a redirect, the setup screen or a login
page counts as a miss. Use the Pi's own address (`http://<pi-address>:30000`): the players' Cloudflare
address is not checked. A Foundry that stays slow gets no second reminder, and a link that flaps posts a
down and back pair each time.

`--once` makes one check and exits with 1 if Foundry is not healthy or a post is unsent. One check
alone never posts "down" (it takes `--fail` misses in a row), so to test posting use
`--once --post --fail 1` against a stopped test server.

The watch only works while this PC is on and can reach the Pi. A copy that runs on the Pi itself would be
a stage script and needs your OK (not done).

## Stale backup copies

The copies on this PC are only worth something while they keep arriving. If this PC stays off (or
the two tasks break) for days, the backups exist only on the Pi, and nothing says so. So the Pi's
Discord bot (stage 8) DMs you when the newest successful copy of a kind, restic or snapshot, is
older than 3 days, checked for each kind on its own (PB-06). Restic arriving every night does not
hide a snapshot copy that stopped, and the other way round.

How it works: after a successful run, `pull-restic.ps1` and `pull-snapshot.ps1` (through
`scripts/pi/record-pull.ps1`) run one fixed command on the Pi over SSH,
`/opt/foundry-ai-tool/backup/record-pull.sh restic` or `... snapshot`. The helper (installed by
stage 6) writes the Pi's own clock into `/var/lib/foundry-backup-pulls/restic.json` or
`snapshot.json`: `{"version":1,"kind":"restic","pulledAt":"2026-10-06T10:31:02Z"}`. The files hold
no secrets. The folder is `root:root` 0755 and sits outside `/var/lib/foundry-ai-tool` on purpose:
the foundry user owns that tree, so a compromised foundry process could swap a folder inside it for
a symbolic link and make the root helper write somewhere else. The bot (as foundry) only reads the
folder. Stage 6 refuses a symbolic link in its place, and the helper refuses a symbolic link as the
folder or as the target file (exit 70). A run that skips because `dietpi-backup` is busy, fails, or
is a dry run records nothing. The command also shows in the Pi's SSH log (stage 9). If the Pi
cannot be told (it is off, or stage 6 has not been rerun), the pull only logs a WARNING and the
copy still counts as done.

What the snapshot record means: it says "this PC has the newest snapshot", not "the snapshot is
fresh". A snapshot run that finds the newest snapshot already on this PC counts as a copy, so if
`dietpi-backup` itself stops on the Pi, the record keeps being renewed. That case is covered on the
PC by the `WarnAfterDays` log line in `pull-snapshot.ps1`, not by the DM.

The bot reads the folder every 15 minutes (the first check after a bot start waits one interval, so
a restart or a crash loop does not repeat the DM), with the same rules as the space notices. Each
kind is judged on its own: one DM when a kind goes stale (it names the stale kind or kinds and how
long each has been quiet), a reminder at most once every 24 hours for each kind that stays stale,
one "copied again" DM for a kind that gets a fresh copy (a kind that recovers while the other is
still stale gets its own DM, and the other keeps its reminder schedule). A record that cannot be
used also counts: a file that is unreadable or invalid (for example a zero-length file after a power
cut, or a time more than a day in the future), or a kind with no record at all while the other kind
is recorded (the snapshot task missing on a rebuilt PC), is stale once that has lasted longer than
the limit, counted from when the bot first saw it (a bot restart starts that count again). The DM
then says "record unreadable" or "not recorded yet". While nothing at all has been recorded the bot
says nothing (a fresh install or a Pi where stage 6 was just rerun never raises a false alarm). The
DM also shows when each kind was last copied and what to do: turn the PC on, or run the two tasks
in Task Scheduler. Change the limit with `FOUNDRY_AI_BACKUP_STALE_DAYS` in
`/etc/foundry-ai-tool/discord-bot.env` (default 3), then restart the bot
(`systemctl restart foundry-ai-tool-discord-bot`).

Session-over post (I-111, off by default): when a play session ends the bot posts a link to the
player page in one channel. Turn it on in the same env file with `DISCORD_SESSION_POST_CHANNEL_ID`
(the channel) and `FOUNDRY_AI_PLAYER_PAGE_URL` (the link players can open; without it the post stays
off). `FOUNDRY_AI_DASHBOARD_URL` (default `http://127.0.0.1:3100`) is where the bot reads the session
flag and `FOUNDRY_AI_PLAYER_TOKEN` is the dashboard's player token if one is set. A session that
ends while the bot is down is not announced. The bot posts the link to everyone who can read that
channel, so if `FOUNDRY_AI_PLAYER_PAGE_URL` carries a `?token=` (the player token), post only to a
channel that holds nothing but players; never to one where non-players can read it.

Rolling it out (each step with your OK, snapshot first): run stage 6 again (it installs the helper
and the folder, and runs one backup now: **Foundry stops for a minute or two, so never run it during
a game**), then a new tool build (stage 5) and stage 8, so the bot runs the build that reads the
folder. Nothing on the PC needs registering again: the scheduled tasks run the same scripts, which
now call the helper. The first DM for a kind can come only after a copy of that kind was recorded
and 3 days have passed without another. By hand:
`ssh foundry-pi /opt/foundry-ai-tool/backup/record-pull.sh restic` records a copy now (it changes
only that one file), `ssh foundry-pi cat /var/lib/foundry-backup-pulls/restic.json` shows it.
Tests: `node --test scripts/pi/backup-pull-record.test.mjs`.

## Rebuild drill

A drill proved on 2026-10-06 that the Pi can be rebuilt from this repo's stage scripts plus the
newest restic copy on this PC, and timed it. It runs in an ARM64 Debian 13 container on this PC and
never contacts the Pi:

```powershell
.\scripts\pi\rebuild-drill.ps1          # about 10 minutes, mostly stage 5's build
```

The script reads the newest snapshot from `E:\PiBackup\restic` into `E:\Restore\<date>-drill` (so it
also proves this PC can read its copies), starts a container named like the Pi (host name
`foundry-pi`, 4 CPUs, no ports published), runs stages 1 to 3, restores the snapshot
(`scripts/pi/drill/restore.sh`), runs stages 5 to 8, starts Foundry, the bridge and the dashboard
from the unit files the stages wrote, checks the result, and leaves the container stopped. The
repository and the password file are mounted read-only and restic runs with `--no-lock`: nothing
is written to `E:\PiBackup`. Every name starts with `pi-drill-`; it never touches other containers.

**Measured on 2026-10-06** (container under QEMU emulation, 4 CPUs, tool `v0.21.0`, snapshot of
2026-10-05 04:30 with 142 MiB): stage 1 64 s, stage 2 12 s, stage 3 10 s, restore 19 s, stage 5
409 s (the build), stage 6 5 s, stage 7 22 s, stage 8 31 s, start and check 20 s; 611 s in all, plus
Docker's first image pull. A real Pi has no emulation but a slower disk and CPU; the download and
build in stage 5 dominate either way. Add the work no script does: flashing the card (Part A),
Tailscale's login (stage 4), the licence zip and the SSH steps below, each with your OK.

**What it proves** (`scripts/pi/drill/check.sh` runs the checks): stages 1 to 3 and 5 to 8 run in order on a fresh Debian 13 ARM64 system; the
snapshot comes back with the worlds, the dnd5e system, the module, `/etc/foundry-ai-tool` and the
tool's storage; Foundry 14.368 starts on Node 24 with the restored licence and opens the restored
world by itself; the bridge answers on 31414 and 31415; the dashboard answers on 3000; every unit
file passes `systemd-analyze verify`. Debian's restic 0.18 reads the repository that this PC's
restic 0.19 wrote.

**What it does not prove:** flashing and DietPi's first boot; the Tailscale login (stage 4) and
the SSH command log (stage 9); real systemd (the container has none, so a helper starts each unit's
command as the unit says); the Assistant GM browser and so a bridge-to-world round trip (Chromium
crashes under QEMU emulation; it runs natively on the Pi); players or Claude Desktop reaching it.
After a real rebuild, `5-check-world.sh` (a throwaway world) and Claude Desktop's own check do that.

**Rebuilding the real Pi** (each step that changes the Pi needs your OK, and `dietpi-backup 1`
first if there is anything left to keep):

1. Part A with a new card. The host name must be `foundry-pi`: the Foundry licence in the backup is
   bound to it and fails verification under any other name. A new card has a new SSH host key, so
   first clear the old one on this PC (`ssh-keygen -R foundry-pi`, and the same for the Tailscale
   name and the address you use), or SSH refuses with "host key changed".
2. Stages 1, 2 and 3 (stage 3 needs the Linux/Node.js zip again: keep `FoundryVTT-Node-14.368.zip`
   from your Downloads folder or fetch it from your foundryvtt.com account). Then `systemctl stop
foundry`; the restore refuses to run while Foundry runs. Stage 4 (Tailscale) can go here too: a
   new login makes a new machine, so remove the old `foundry-pi` in the Tailscale admin console
   first, or the new one may be named `foundry-pi-1`.
3. Copy the repository and its password to the Pi, into `/var/lib/foundry-restore` (one of our own
   folders, root only; the password is in your password manager if this PC is gone), restore, and
   delete the copies. The restore also stages its work in a subfolder there and removes it when it
   ends, success or failure:

   ```powershell
   ssh foundry-pi 'install -d -m 0700 /var/lib/foundry-restore'
   scp -r E:\PiBackup\restic foundry-pi:/var/lib/foundry-restore/pc-repo
   scp "$env:APPDATA\foundry-ai-tool\restic-pc.pass" foundry-pi:/var/lib/foundry-restore/restic-pc.pass
   Get-Content .\scripts\pi\drill\restore.sh -Raw | ssh foundry-pi 'DRILL_KEEP_SYNCTHING=1 bash -s'
   ssh foundry-pi 'rm -rf /var/lib/foundry-restore'
   ```

4. The restore installs restic, restores the newest snapshot (`SNAPSHOT=<id>` for another) into the
   staging folder, copies the three folders into place and fixes the owners (stage 9's
   `ssh-log` folder goes back to root only).
5. Stages 5, 6, 7 and 8 in that order, then stage 9 (the SSH command log; it changes the SSH login
   key line, so it needs its own OK, a `dietpi-backup 1` first, and the 5-minute confirmation from a
   new connection described in its header), then stage 15 if it had run on the old Pi (SSH keys only,
   same kind of OK and confirmation), then `systemctl start foundry`. The worlds (with their
   users), `assistant-gm.env` and, if the snapshot is newer than its stage, the Discord bot's token
   come back from the snapshot.

**Order matters, and four things the drill found:**

- **Restore before stage 6.** The snapshot holds the Pi's old `restic-pi.pass`. Stage 6 keeps an
  existing password file and builds the new repository with it, so the copy job on this PC (which
  holds the same password in `restic-pi.pass`) keeps working. Restoring after stage 6 left a new
  repository that the restored password cannot open ("wrong password or no key found").
- **The user id changes.** The old `foundry` user was 988; a new install may get another number.
  `restore.sh` reads the old owner and fixes it (`chown -R` for the data, `chgrp` for the files in
  `/etc/foundry-ai-tool` that were group `foundry`; secrets stay root's).
- **Syncthing's identity is in the snapshot.** A real rebuild keeps it, so every PC still trusts
  the Pi. The drill leaves it out (`DRILL_KEEP_SYNCTHING` unset): a second Syncthing with the real
  Pi's key, dialling out from a container, could meet the real peers and sync the vault from an old
  copy. The drill's check compares the hash of the restored device certificate with the one in the
  container and fails if the real Pi's identity is there. The `DRILL_KEEP_SYNCTHING=1` path (the
  real rebuild, where the hashes must match) has **not been run yet**: the first real rebuild is its
  first run. Notes written only once (`Home.md`, `Prep/Templates/`) come back from the snapshot;
  if the snapshot is older than the GM's last edits, the GM's PC holds the newer copy and Syncthing
  may keep one side as a `.sync-conflict` file. After a rebuild, look for those in the GM vault and
  keep the GM's version.
- **A restore on Windows exits 1** with "A required privilege is not held by the client" for one
  Chromium symlink under `/var/lib/foundry-ai-tool/.config/pulse`. Everything else is restored; the
  drill script excludes that folder. The restore on Windows drops Linux owners and modes, so for a
  real rebuild restore inside Linux as above.

Not in the snapshot, so rebuilt by the stages: `/opt` (Foundry, Node, the tool), Tailscale's state,
the SSH key line from Part A, the Assistant GM's browser profile (it logs in again), recordings,
the licence zip itself. The drill does not run `pull-restic.ps1`: after the first night on the new
Pi, check `E:\PiBackup\logs\restic-<month>.log` that the copy job still reads the new repository
with the password it holds.

The container is left stopped for inspection (`docker start pi-drill-<stamp>` and `docker exec -it
... bash`), even if a stage fails; remove it with `docker rm` when you are done. The script never
deletes anything, and prints at the end where things are left. The scratch folder
(`E:\Restore\<date>-drill`) and each drill container hold restored secrets (the licence,
`/etc/foundry-ai-tool`, tokens): delete them yourself when you are done.

## The GM vault and Syncthing

The bridge writes the GM's Obsidian vault on the Pi, in `/var/lib/foundry-ai-tool/obsidian/gm`: the
session log, the change log, the play stats and the Library notes. `7-vault.sh` (stage 7) sets that
up and runs Syncthing as its own service, `foundry-ai-tool-syncthing` (user `foundry`, its files in
`/var/lib/foundry-ai-tool/syncthing`, never in Foundry's data folder). Stage 7 also takes
`DASHBOARD_FOUNDRY_URL=https://play.<domain>` for the initiative ribbon's portraits (see
[REMOTE-ACCESS.md](REMOTE-ACCESS.md), Part C step 4). Syncthing keeps the folder
`foundry-gm-vault` the same on every PC you add, in both directions: the GM's own notes in `Prep/` go
back to the Pi and into its nightly backups. The player vault is not part of this yet (it waits for
O7, D-091).

How it is set up: UPnP and NAT-PMP are off (Syncthing never asks the router to open a port, the same
rule as Foundry's `--noupnp`), usage and crash reports are off, and the web page of Syncthing listens
on the Pi itself only. Global discovery and relays are on, so a PC outside the home still finds the
Pi; relays only pass on traffic that is encrypted end to end. A PC can connect only after the Pi
has added its device ID. Each PC keeps its own `.obsidian/workspace*.json`, `.obsidian/cache` and
`.trash` out of the sync (`.stignore`, which Syncthing does not sync, so every PC has its own copy;
both scripts write it). The Pi runs Syncthing 1.x (Debian 13) and a PC installed with winget runs
2.x; they speak the same protocol and should sync with each other (the container test used 1.x on both
sides; the first sync with a real PC is the check).

**Add a PC** (the GM's PC, or this PC to check):

1. On that PC: `winget install Syncthing.Syncthing`, then in PowerShell 7
   `.\scripts\pi\setup-syncthing-pc.ps1 -PiDeviceId <the Pi's device ID>` (Claude prints the ID
   after stage 7). It registers a hidden task "Syncthing" that starts at logon, sets the options
   above, adds the Pi and the folder at `Documents\Obsidian\Foundry GM vault` (change it with
   `-VaultPath`), and prints this PC's device ID. `-Remove` takes the task away again and leaves the
   settings and the vault alone.
2. Give that device ID to Claude. Claude runs stage 7 again with `PEER_ID=<id>` and
   `PEER_NAME=<a name>`: the Pi adds the PC and shares the folder, and it starts to sync (no
   duplicates if it runs twice). `VAULT_NAME` there is the vault's folder name on the PC (default
   `Foundry GM vault`), which the dashboard's "Open in Obsidian" links use.
3. Open the folder as a vault in Obsidian.

The Foundry mirror is a separate, per-world switch (D-083): the Foundry setting "AI Tool: Obsidian
mirror (writes)" plus the guarded `plan-obsidian-mirror` tool, which the GM asks Claude for
(Admin set). It stays off until the GM decides to use it for a world. The session, change and stats
notes are written to the vault whenever the folder is set, mirror or not.

## Storage space check

The user's rule (2026-10-06): every backup, snapshot and sync checks its source and its destination
for at least 20 % free space. Below 20 % the job still runs but warns; it stops only when space is
critical: under 5 % free on a disk the job uses. There is no "enough room for the data" test: restic
stores only what changed and its repository sits on the same disk as its sources, so the size of the
sources says nothing about what is needed. A full disk is the quiet way a backup chain stops working, so the warning has to reach someone.

**On the Pi** (stage 10, `10-space-check.sh`): `/opt/foundry-ai-tool/space/space-check.sh` runs every
hour from the systemd timer `foundry-space-check.timer` (and once after a boot or a missed hour) and
writes `/var/lib/foundry-ai-tool/space/status.json`: one entry per filesystem with its free bytes and
percentage, the paths and jobs that use it, and a level (`ok`, `low` below 20 %, `critical` below
5 %). It looks at `/var/lib/foundry` (the restic source), `/var/lib/foundry-ai-tool` (the tool's
storage, the Syncthing vault, the recordings), `/etc/foundry-ai-tool`, the restic repository on the
Pi and `/mnt/dietpi-backup` (the system snapshots). A low or critical disk also logs a WARNING or
CRITICAL line to the journal: `journalctl -u foundry-space-check -n 20`. The status file holds no
secrets. The Discord bot (a DM) and the dashboard (a GM-only banner) read it.

**The nightly restic backup** (stage 6) calls the checker first, as its own job: it records `lastJob`
in the status file, runs anyway below 20 %, and at critical (a disk that holds its sources or the
repository is under 5 % free) exits without stopping Foundry, with the message "backup skipped: disk
space is critical" in `journalctl -u foundry-backup`. The call has a 60 second limit; a checker that
fails or hangs only logs a warning and the backup runs. A job run never changes the disks' levels in
the status file, only `lastJob`. Run stage 6 again
after stage 10 so the backup script gets the call; without the checker the backup simply runs as
before. The system snapshots are DietPi's own job (`dietpi-backup`): they are not changed, and the
hourly check covers the disk they sit on.

**Syncthing** (stage 7): the Pi's side is covered by the hourly check (the vault folder is on
`/var/lib/foundry-ai-tool`). Each receiving PC is covered by the PC check below, which looks at the
folder Syncthing writes the vault into.

**On this PC**: `scripts/pi/space-check.ps1` is the helper both pull scripts call at their start
(`pull-snapshot.ps1` and `pull-restic.ps1`). It checks this PC's backup drive (`E:\PiBackup`) and
the vault folder Syncthing writes into (read from Syncthing's config, else `Documents\Obsidian\Foundry
GM vault`), and reads the Pi's `status.json` over read-only SSH (`ssh foundry-pi cat ...`). A status
that is missing, unreachable or older than 3 hours is only a warning line in the log, never an error.
Below 20 % free on the Pi's source or on a local disk the pull logs a WARNING (in
`E:\PiBackup\logs\`) and shows a Windows notification that names the disk, the free percentage and
GB, and the job. At critical (under 5 %) on the backup drive the pull skips the copy and exits 1 with
a clear log line; a critical Pi source only warns, because the copy is how its data gets away.
The notification uses Windows PowerShell 5.1's toast classes (built in, no module to install) and
works from the scheduled tasks, which run as you while you are signed in.

Run the PC check by hand (PowerShell 7). `-Test` prints what it would notify and shows nothing;
`-SimulateFreePercent` pretends every disk has that much free, to see the warnings:

```powershell
pwsh -NoProfile -File .\scripts\pi\space-check.ps1 -Test
pwsh -NoProfile -File .\scripts\pi\space-check.ps1 -Test -SimulateFreePercent 3
pwsh -NoProfile -File .\scripts\pi\space-check.ps1          # the real check, with notifications
```

The Pi's side by hand: `ssh foundry-pi cat /var/lib/foundry-ai-tool/space/status.json`, or run the
checker itself with `ssh foundry-pi /opt/foundry-ai-tool/space/space-check.sh --print` (prints,
writes nothing). Tests: `node --test scripts/pi/space-check.test.mjs`.

## Recordings

The Pi records the Discord voice channel but does not transcribe: it has no graphics card, and speech
to text runs on this PC (faster-whisper). After `/record stop` the bot converts the recording on the
Pi. This PC's session pipeline (`tools/session-notes/auto.ps1`, with `FVTT_PI_HOST=foundry-pi`) then
copies every finished recording over SSH through Tailscale, checks each file, and marks it copied on
the Pi; the Pi deletes copied recordings after 7 days. The recorded audio on this PC is kept (D-097):
nothing deletes it automatically, only a player's request does. Details:
[the bot's README](../../packages/discord-bot/README.md#on-the-orange-pi-d-068).

## Your UniFi gateway

Very little, and nothing that opens your network. Menu names as in UniFi Network 9; older versions
put them in slightly different places.

1. **Give the Pi a fixed address** (do this after Part A, once the Pi shows up): **Client Devices**,
   click `foundry-pi`, **Settings**, switch on **Fixed IP Address** and keep the address it has.
   While you are there, switch on **Local DNS Record** with the name `foundry-pi`, so the PC finds
   it even when `foundry-pi.local` does not answer.
2. **Leave UPnP off:** **Settings**, **Internet**, your WAN, **UPnP** off (the default). Foundry is
   started with `--noupnp` anyway, but with UPnP off nothing on your network can open a port by
   itself.
3. **No port forwarding:** add nothing under **Port Forwarding**. Players come in through the
   Cloudflare tunnel (Part C) and you through Tailscale; both dial out.
4. **Same network as this PC:** plug the Pi into the network your PC is on (not a guest or isolated
   network). If you ever move it to its own VLAN, switch on **Multicast DNS** for both networks
   (**Settings**, **Networks**, global settings) and allow the PC to reach the Pi in the firewall
   rules; until then, keep it simple.
5. **If the tunnel or Tailscale will not connect** with CyberSecure / threat management or ad
   blocking on: look in the gateway's threat log for blocked Cloudflare (`*.argotunnel.com`,
   `*.cloudflare.com`) or Tailscale addresses and allow them. Normally nothing is needed.

## Part C: players and the GM from outside

Players reach Foundry through a Cloudflare Tunnel with Cloudflare Access in front (D-075). They
install nothing and join no private network: they open a normal web address and confirm their email
with a one-time code about once a month. Foundry's login page is never open to the internet, and no
router ports are opened (the tunnel dials out).

The dashboard checks Cloudflare Access's signed token instead of trusting the email header (vault
idea I-022, built). Its public name is added last, after its Access application exists. Part C
went live for Foundry on 2026-10-14, and the dashboard name was added later the same day.

What you do:

1. **Buy a domain** you like through Cloudflare Registrar (sold at cost, about 10 USD a year), so its
   DNS is at Cloudflare from the start. Claude never handles payment or logins.
2. **Create a free Cloudflare account** (Access is free for small teams) and open its Zero Trust
   dashboard, now called Cloudflare One. Add **One-time PIN** as a login method (Integrations,
   Identity providers; new accounts no longer have it switched on).
3. **Make the tunnel, the Access application and the route** in the Cloudflare dashboard, with the
   players' and the GM's email addresses in the Access policy (they stay out of the repo and the
   vault). The tunnel is managed remotely: every public name and login rule lives in the dashboard.
   Click-by-click, including the `http://` in the route's Service URL and the "Validate the Access
   JWT at the tunnel" option: [Remote access, Part C](REMOTE-ACCESS.md#part-c-players-and-the-gm-reach-the-orange-pi-through-cloudflare).
4. **Set the tunnel token yourself.** The Pi never logs in to Cloudflare. The tunnel page shows a
   token; you paste it into `set-tunnel-token.sh` in your own SSH session, which asks without showing
   it and stores it in a root-only file. Claude never sees it.

What Claude does: after a `dietpi-backup 1` snapshot and your OK, runs stage 12 once with
`FOUNDRY_PUBLIC_HOST=<Foundry's public name>`. That installs `cloudflared` on the Pi as a service
(from Cloudflare's apt repository, with its current signing key, started once the token is there) and
sets Foundry's proxy options for the public name. Which name goes to Foundry and which to the
dashboard (GM emails only) is set in the Cloudflare dashboard, not on the Pi. Then the phone test from
outside before anyone gets the address. Templates: `deploy/cloudflare/`; background:
[Remote access](REMOTE-ACCESS.md).

## SSH keys only (stage 15)

Until stage 15 ran, the Pi's SSH server listened on every address and took the root password as well
as a key (the 2026-10-14 network review, D-123). Before the tunnel in Part C goes live, stage 15
turns password login off for SSH: only a key opens the door, for root too.

- **What changes:** one new file, `/etc/ssh/sshd_config.d/00-foundry-keys-only.conf`, with
  `PasswordAuthentication no`, `KbdInteractiveAuthentication no` and
  `PermitRootLogin prohibit-password`. The main `sshd_config` is not edited. The name starts with
  `00-` so it is read before any other drop-in (sshd keeps the first value it reads).
- **Your console login with the root password still works.** Plug a screen and keyboard into the Pi
  and log in as root with the password, as before; this stage only closes the password door of the
  network login. Keep the root password where you keep the others: it is the way back in if the PC's
  key is ever lost. (The stage warns if root has no usable password.)
- **What it checks before and after:** it stops without changing anything unless root's key file
  holds at least one valid key (the PC's key; stage 9's command prefix is read correctly), sshd
  really takes that key (`PubkeyAuthentication yes`, `AuthorizedKeysFile` reaching
  `.ssh/authorized_keys`, `AuthenticationMethods any`), the main `sshd_config` includes the drop-in
  folder, ssh is not socket-activated, the ssh service can be found, and **no `Match` block sets a
  login value** (a `Match Address` block that turns passwords back on would beat the drop-in
  whatever the file order, so the stage lists those lines and stops). After writing the file it
  runs `sshd -t`; if that fails, the old drop-in is put back (or the new one removed) and ssh is
  not touched. Then it asks `sshd -T` what root would get from the machine itself, from a LAN
  address and from a public one, and compares the three values: if an earlier line or file
  overrides them, the drop-in is rolled back and the lines that win are listed. Then it arms the
  safety timer and **reloads** ssh (a reload, not a restart: the session running the stage stays
  up). If ssh is not active after the reload (also when the reload itself failed), the service is
  started again; where this run changed the drop-in the old one is put back first, and the
  safety timer is cancelled only once ssh is active again (otherwise it stays armed). At the end it asks the running sshd, as a client without a key, what it offers (a
  `live:` line: `Permission denied (publickey)` means keys only has really taken effect; a line
  that still names `password` is a warning) and prints the three effective values.
- **Safety timer:** like stage 9, the run arms a 5-minute timer that removes the drop-in again
  (or puts the old one back) and reloads ssh, or starts it if it is down, unless a new connection
  confirms. A key that does not work can never lock you out for good. These command lines are
  **bash** (Git Bash, or Claude's Bash tool), not PowerShell: PowerShell's `cat` takes one file
  and adds Windows line endings, so the pipe would send the Pi nothing and still look like it
  worked. From the repo folder on this PC, after a `dietpi-backup 1` snapshot and your OK, in
  default permission mode and not on a game-night day:

  ```bash
  cat scripts/pi/remote/lib.sh scripts/pi/remote/15-ssh-keys-only.sh | ssh foundry-pi 'bash -s'
  ssh -o ControlPath=none -o BatchMode=yes -o PreferredAuthentications=publickey -o PasswordAuthentication=no foundry-pi true
  cat scripts/pi/remote/lib.sh scripts/pi/remote/15-ssh-keys-only.sh | ssh -o ControlPath=none -o BatchMode=yes -o PreferredAuthentications=publickey -o PasswordAuthentication=no foundry-pi 'CONFIRM=1 bash -s'
  ```

  The second line must print nothing and exit 0 (key login works); the third cancels the timer
  and leaves a marker (`/etc/ssh/foundry-keys-only.confirmed`; the confirm refuses, and leaves the
  timer armed, when the running sshd still offers a password, and it writes no marker when the
  drop-in is gone). `UNDO=1 bash -s` in the first
  line's place removes the drop-in and the marker again.

- **Running it again is safe:** with the drop-in already in place it reloads and looks at the
  safety net. A timer from the first run that is still armed is left armed (the output says
  `CONFIRM=1` is still needed); with no timer and no confirmation (the first run stopped, or the Pi
  rebooted) it arms a new one before it reloads; after `CONFIRM=1` it only reloads.
- **Two edges:** the timer is a transient systemd unit, so a reboot inside the 5 minutes loses it
  (the drop-in stays; run the stage again to arm a new timer, or `UNDO=1`, or use the console).
  `UNDO=1` removes the drop-in but does not put a `.before` copy back (the Pi has none; the
  stage only makes one when it replaces an older drop-in of its own).
- Tested in the ARM64 container (`scripts/pi/container-test/ssh-keys-only-scenarios.sh`,
  `node --test scripts/pi/ssh-keys-only.test.mjs`; Docker needed, `PI_SSH_KEYS_ONLY_CONTAINER=1`)
  with the real `sshd -t` and `sshd -T` and, for the `live:` check, a real running sshd.

## Licensed content (the books and Curse of Strahd)

D&D Beyond imports stay a job for this PC: DDB Importer calls its proxy from the GM's browser, and the
proxy holds your D&D Beyond login cookie, so it must never be reachable through Cloudflare or from
another machine. Import on the PC (the proxy and Adventure Muncher against the PC's Foundry). Then two
scripts move the result to the Pi, in two steps so that you can look in between:

1. **On this PC, with the world stopped in Foundry** (its database files are in use while it runs):

   ```powershell
   .\scripts\pi\push-world.ps1 -World curse-of-strahd
   ```

   It scans the world and the compendium packs of the modules for every image and sound path
   (`scripts/pi/world-refs.mjs`, which reads copies of the databases and never touches a running
   Foundry), and stops when anything is wrong: a missing file or one whose letter case differs from
   the real name (Windows ignores case, the Pi does not), a module that is not in the bundle, a module
   that is switched on in the world but not shipped (turn it off in the world first, as ddb-importer
   must be), a setting that looks like a secret, or a GM user that has a password (the hash Foundry 14
   stores for a user with no password does not count). Then it checks the
   free space on this PC and on the Pi (below 20 % free it warns, below 5 % it stops), builds one
   `.tar` with a checksum for every file, and uploads it to `/var/lib/foundry-import/` on the Pi. It
   never runs stage 11. `-NoUpload` builds and checks only.

2. **Stage 11 on the Pi**, after a `dietpi-backup 1` snapshot and your OK. `push-world.ps1` prints
   the exact command at the end (`BUNDLE=...`).

What is copied:

- the world (`Data/worlds/<id>`);
- the private modules (default `aitool-content`, `dnd-players-handbook`, `foundryvtt-actor-studio`;
  the content module holds the imported book images, D-084);
- the `Data/ddb-images/` and `Data/tokenizer/` folders the world uses (without them, scenes and
  tokens show broken images). The adventure archives in `Data/ddb-adventure/` are not copied: they
  are only needed to import again, which stays a job for this PC.

What never leaves this PC: **ddb-importer** (its settings can hold the D&D Beyond cookie) and the
bridge module (stage 5 installs it from the release), and any env file, proxy file or Adventure
Muncher file. `push-world.ps1` refuses them, and stage 11 checks the tar again before it extracts
anything. World settings whose names look like a secret (a cookie, a token, a key) stop the push; the
names are shown, never the values. A `ddb-importer.*` setting that you reviewed and that is only a
setting (a folder name, a compendium name) can be let through with a narrow pattern, for example
`-AllowSettingKeys 'ddb-importer.entity-*'`. A setting whose own name (after the module id) has
cobalt, cookie, patreon, secret, password, credential, bearer, an API key or a private key in it, or
that is or ends in token or key (`discordToken`, `refresh-token`, `privateKey`), is always a problem,
whatever the list says. Module names do not count (vtta-tokenizer, Token Action HUD); a harmless
setting that ends in token goes on the short safe list in `world-refs.mjs` (today `core.defaultToken`).

Images that the books point at but that are not on this PC stop the push too. When you have looked
at them and they are known gaps (a book image the importer never fetched), list them with
`-AllowMissing 'ddb-images/adventures/Curse_of_Strahd/gone.webp','modules/dnd-players-handbook/missing/*'` (an exact path or a
prefix ending in `*` that names a root and a folder before it, so `modules/*` is refused; no `..`, no
leading slash). A matching path that is really missing on disk is then no problem and is listed in
the run. A wrong-case path stays a problem, and so does a path outside the bundle that exists on disk
(a file under `Data/assets/`, say), because push-world would not copy it. The list goes into `MANIFEST.txt` (`allow-missing:`). `world-refs.mjs` also leaves
out the D&D Beyond importer's own metadata under `flags.ddb` (Foundry never loads it) and treats
`nue/defaultscene/` as one of Foundry's own files.

What stage 11 does with it:

- **The campaign world is never replaced** unless you run it with `REPLACE_WORLD=1`. If the world is
  already on the Pi, it stays as it is and only the modules and images are updated.
- **The modules are always replaced**, even when the campaign world is kept. A run in the middle of the
  campaign therefore swaps in the PC's copy of each module, and edits made on the Pi inside a module's
  own compendiums (the content module's packs, say) are not in it. The old module folder is in
  `prev-<time>/modules/<id>`: stop Foundry and copy the pack back from there (or ask Claude to). Edits
  in the world itself (actors, journals, scenes) are not touched.
- **A test copy, `strahd-kit`** ("Curse of Strahd (test copy for kit runs)"), is made from the bundle
  every time and replaced on every run. The test kit runs there, so a test never touches the
  campaign. `KIT_WORLD=` (empty) skips it. `LAUNCH=strahd-kit` starts Foundry on the copy instead.
- **Old copies are moved, not deleted**, to `/var/lib/foundry-import/prev-<time>/`; remove them later
  only with your OK. The images are merged into the existing folders, so nothing is deleted there,
  and an existing image with the same name but other content is copied to `prev-<time>/` first.
- **Free space** is checked first (the 20 % rule: a warning below 20 %, a stop below 5 %, and a stop
  when there is less room than twice the bundle). If a run fails after Foundry was stopped, the
  `options.json` world is put back to what it was and Foundry and the Assistant GM browser start again.
- **Each new world gets a generated GM password**, kept only in `/etc/foundry-ai-tool/world-<id>.env`
  (root only, never printed). The GM reads it with `ssh foundry-pi cat
/etc/foundry-ai-tool/world-curse-of-strahd.env` and then changes it in Foundry if he likes. The
  Assistant GM and the bridge are set up in each world like in stage 5, and the Assistant GM browser
  restarts on the campaign world.
- The world's GM user is `Gamemaster` (`GM_USER=` for another name) and must have no password on the
  PC when you push, because stage 11 joins as that user once to set the new password.
- **The `strahd-kit` default is only for `curse-of-strahd`.** Any other `WORLD` must say
  `KIT_WORLD=` (no test copy) or `KIT_WORLD=<id> KIT_TITLE=<title>`, or the run stops before
  anything changes, so another bundle can never reset `strahd-kit`.
- **A kit world is only reset if it is a kit copy of the same `WORLD`.** Every reset writes
  `flags["foundry-ai-tool"].kitOf = <WORLD>` into the kit world's `world.json`. If a world with the
  `KIT_WORLD` id is already installed and has no such marker for this `WORLD`, the run stops before
  anything changes, so a campaign run can never overwrite an installed training world from the Strahd
  bundle. The Pi's older `strahd-kit` counts for `curse-of-strahd` and gets the marker on its next
  reset. Run with `REPLACE_KIT=1` only when replacing that world is meant; it never lifts the refusal
  to use `curse-of-strahd`, `strahd-kit` or the `LAUNCH` world as the kit world of another `WORLD`.

### Training world (D-118)

Danni's Frostmaiden training world goes in next to the campaign, while Foundry keeps launching
`curse-of-strahd`. It is a copy of the PC's kit world trimmed to Frostmaiden, pushed with
`push-world.ps1 -World frostmaiden-training -Modules '' -PiModules aitool-content,dnd-players-handbook,foundryvtt-actor-studio`
(`-Modules ''` means no modules; from a shell `-Modules @()` does not work with `pwsh -File`, which drops the
empty array. The three active modules are already on the Pi from the campaign bundle, and stage 11
replaces the Pi's module folders with the bundle's, so shipping them again could swap out the Pi's
own copies; `-PiModules` writes each one with the version of the PC's copy into the bundle's
`MANIFEST.txt` (`pi-modules: aitool-content@1.2.0, ...`), and stage 11 stops before anything changes
if one is not installed on the Pi, or if the Pi's copy is older than the PC's: update it on the Pi
first (the campaign bundle, or stage 13 for actor-studio). Versions compare as numbers; with the same
numbers, two suffixes like `2.10.5-aitool.4` and `2.10.5-aitool.5` compare their counter, and any other
suffix mix, like `1.2.0` and `1.2.0-rc1`, cannot be compared and only warns). The command push-world prints at the
end for this world has `KIT_WORLD= LAUNCH=curse-of-strahd`; add `EXTRA_GM_USER=Claude` to it by hand
(push-world only hints at it). The settings are:

```bash
WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd EXTRA_GM_USER=Claude
```

- `LAUNCH` may name any world that is already installed, so the new world is provisioned and
  Foundry goes back to the campaign. For any `WORLD` other than `curse-of-strahd` it must be set
  and not empty (like `KIT_WORLD`), so a forgotten or empty `LAUNCH` can never switch the Pi to the
  new world. For such a world `KIT_WORLD` may not be `curse-of-strahd`, `strahd-kit` (the campaign's
  test copy) or the `LAUNCH` world either: every run resets the kit world from the bundle.
- A bundle for any world other than `curse-of-strahd` that ships a module is refused before anything
  stops, because the campaign owns the modules: use `-PiModules` as above, or run with
  `SHIP_MODULES=1` only when replacing the Pi's modules is meant. The campaign's own bundle ships its
  modules as always, also with `LAUNCH=strahd-kit`.
- `EXTRA_GM_USER=Claude` makes a second full GM with its own generated password. Both logins are in
  `/etc/foundry-ai-tool/world-frostmaiden-training.env` (`GM_USER`, `GM_PASSWORD`, `EXTRA_GM_USER`,
  `EXTRA_GM_PASSWORD`; root only, never printed). The extra GM is added to the file once; a run
  again keeps both passwords. A file that already names another extra GM stops the run before
  anything changes, and so does an extra GM named like the world's GM or the Assistant GM (case
  does not matter) or with a space at either end. `EXTRA_GM_USER` needs the Assistant GM driver
  from stage 5 at or after #294 (an older driver ignores the extra GM), and stage 11 refuses an older
  one before anything changes: run stage 5 again first.
- If provisioning fails, run the same command again: a `world-<id>.pending` marker in
  `/etc/foundry-ai-tool/` is written for every world of the run before the first is provisioned and
  stays until that world's provisioning has worked, so a plain rerun provisions the kept
  world again with the passwords already in its file (no `REPLACE_WORLD=1` needed). On any failure
  Foundry comes back on the world it launched before the run (the campaign, unless it was switched to
  the training world; see "Switching Foundry to the training world and back").
- Only the GM user is checked on the PC (push-world stops unless `Gamemaster` has no password).
  Other users in the copy, such as the test server's passwordless `Player`, go to the Pi as they are,
  so delete them in the copy first, or give them a password in Foundry on the Pi afterwards.
- Then stage 13 with `WORLD=frostmaiden-training KIT_WORLD=` turns Actor Studio's usage tracking off
  there too. Like stage 11, stage 13 only defaults `KIT_WORLD` to `strahd-kit` for
  `curse-of-strahd`: any other world must set it, so a training run cannot change strahd-kit.

#### Switching Foundry to the training world and back

Who: Claude, when the user asks for it, never the GM and never by hand on the Pi (decision D-118). The user says when the training call is, a session does the switch under the `pi-work`
rules, and after the call the same session switches back to `curse-of-strahd`. Do not leave the Pi on
the training world: the players and Danni's real game open whatever world Foundry launches.

How: there is no stage that only switches worlds. The switch is stage 11 (`11-world.sh`) run with a
training bundle and `LAUNCH` set to the world Foundry should start. Both directions use the same bundle
command, and the installed training world is kept, with its passwords, because `REPLACE_WORLD` stays 0:

1. Check that nobody is online (Foundry stops for a few minutes) and take a `dietpi-backup 1` snapshot.
   Get the user's OK for this run.
2. On this PC build a fresh bundle with the `push-world.ps1` command above. Stage 11 deletes the bundle
   after a successful run, so each switch needs its own.
3. Switch to the training world: run stage 11 with
   `WORLD=frostmaiden-training KIT_WORLD= LAUNCH=frostmaiden-training EXTRA_GM_USER=Claude`.
4. After the call, do steps 1 and 2 again (a snapshot taken for step 3 on an earlier day does not
   count: stage 11 wants one from today), then run stage 11 with
   `WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd EXTRA_GM_USER=Claude`. Check on the Pi
   that `options.json` launches `curse-of-strahd` and that `/api/status` shows the campaign world.

If step 4 fails, Foundry stays on the training world, because a failed run puts back whatever world it
launched before the run. Run step 4 again until it works, and do not end the session before it has.
Build each bundle while the PC's Foundry does not have the world open; the bundle is still fully
checked even though the kept world is not replaced from it.

Because the world is kept, anything changed in it during a call stays for the next one. To start over,
add `REPLACE_WORLD=1` to the command of step 3.

If a proxy ever has to run elsewhere, it is our patched copy (it reads the cookie from a file and
keeps it out of its logs), bound to `127.0.0.1`, never the upstream one (which logs the cookie).

## Player character creation (stage 13)

For session 0 the players make their own characters in Actor Studio (D-112, D-113): built at
level 1, then levelled up twice to the table's starting level 3 (the sheet's Level Up button needs
Actor Studio's Milestone Levelling, set by the GM; stage 13 does not set it). Two
things have to be true in the Strahd world on the Pi: the Actor Studio build is our fork, and the
world lets players do it. Stage 13 does both, after a `dietpi-backup 1` snapshot and your OK (Foundry stops for a few minutes). It needs
stages 5 and 11 first (the tool's build for Chromium, and the GM login in
`/etc/foundry-ai-tool/world-<id>.env`). From the repo folder on this PC, in Git Bash (or Claude's
Bash tool), not PowerShell: PowerShell's `cat` takes one file and adds Windows line endings, so the
pipe would send the Pi nothing, or a script bash rejects:

```bash
scp scripts/pi/remote/player-creation-settings.mjs foundry-pi:/root/ && cat scripts/pi/remote/lib.sh scripts/pi/remote/lib-gm-passwords.sh scripts/pi/remote/13-player-creation.sh | ssh foundry-pi 'bash -s'
```

The `scp` is the in-browser part: the stage cannot read a second file from the stream the other
stages come in on, so the file goes over first (the way `assistant-gm.mjs` does for stage 5). The stage
installs it into `/opt/foundry-ai-tool/gm-browser/` and removes the upload; run again without a new
`scp` and it uses the installed copy. Environment variables go in front of `bash`, for example
`ssh foundry-pi 'KIT_WORLD= bash -s'`.

Stages 11 and 13 end with the read-only GM password check (the extra `lib-gm-passwords.sh` in the pipe,
the same check as `gm-passwords.sh`): it warns when Foundry has no administrator password or a world has a
Gamemaster or Assistant GM without one, so a world or GM user added after stage 12 is noticed. It changes
nothing and does not fail the stage. Without the extra file the stage warns that the check was skipped.

- **A. The build.** `STUDIO_VERSION` and `STUDIO_SHA256` are pinned in the script
  (`PINNED_VERSION`, `PINNED_SHA256`). The zip comes from
  `github.com/Gnuminator/foundryvtt-actor-studio/releases/download/<version>/module.zip` and must match
  the checksum. Before anything is extracted the stage lists it: no absolute paths, no `..`, no
  backslashes, no links or other special entries, a `module.json` at the top, a size limit and enough
  free space. Then `module.json` must say id `foundryvtt-actor-studio` and the pinned version. If that
  version is already installed, part A is skipped and nothing is downloaded. A newer installed build
  (Foundry's own Update follows the fork's latest release) stops the stage unless
  `ALLOW_DOWNGRADE=1`. Otherwise the services
  stop, the old module folder moves to `/var/lib/foundry-import/prev-<time>/modules/` (never deleted;
  put back by itself if the swap fails) and the new one takes its place, owned by `foundry`.
  The pinned build is the fork's `2.10.5-aitool.4` release (its `module.zip` checksum is in the
  script). A pinned checksum of `PENDING-RELEASE` (for a newer build whose release does not exist
  yet) makes the stage refuse to run unless it is given `STUDIO_ZIP` (a `.zip` under `/var/lib/foundry-import/`) and
  `STUDIO_SHA256` (and `STUDIO_VERSION` when the zip is not the pinned version). `STUDIO_VERSION` and
  `STUDIO_SHA256` together, without a zip, download that release instead (both or neither).
- **B. The settings, in `WORLD` (default `curse-of-strahd`) and `KIT_WORLD` (default `strahd-kit`;
  empty skips it).** For each world, Foundry runs that world (`options.json` is changed for the
  run) and a headless Chromium joins as the world's GM, with the login from `world-<id>.env`
  (never printed, passed in the environment and not on a command line). It sets
  `core.permissions` so `ACTOR_CREATE` includes Player and Trusted Player (roles already there stay),
  and Actor Studio's world settings `enableEquipmentSelection` = true and `compendiumSources` with
  `equipment` = `["dnd-players-handbook.equipment"]` (the other sources keep their values), and
  turns Actor Studio's per-user `usage-tracking` off for every user who has it saved as on. It prints
  the values before and after, reloads the world and reads them back, and the stage stops with an
  error on any mismatch, if Actor Studio is not switched on in the world, or if that pack is not in
  the world. A second run changes nothing.
- **Before anything stops** the Assistant GM browser stops and Foundry's `/api/status` must answer
  and count nobody online; otherwise the stage stops (`FORCE=1` stops Foundry anyway).
- **Afterwards** `options.json` launches the world it launched before the run, Foundry and the
  Assistant GM browser start again if they ran before, and the stage waits for "joined world". If the
  run fails after Foundry was stopped, `options.json`, Foundry and the Assistant GM browser are put
  back as they were. Free
  space is checked first (the 20 % rule). Without systemd (a test container) part B is skipped with a
  warning. **Run it after stage 11, every time:** stage 11 always swaps in the PC's copy of each
  module, `foundryvtt-actor-studio` included, and resets `strahd-kit` from the bundle, so the fork
  build and the kit copy's settings are gone after it (the campaign world keeps its settings).

Tested on 2026-10-08 in an ARM64 Debian 13 container: the download and checksum of the published
`2.10.5-aitool.3`, a second run that skips, a wrong checksum, zips with `..`, an absolute path, a
backslash and a symlink, a wrong id and version, a failed swap that puts the old folder back, and the
settings loop with a faked systemd and a stand-in for the browser script. The browser script itself
(`player-creation-settings.mjs`) was only syntax-checked there; on 2026-10-09 it ran twice against the
PC test server's licensed kit world. The same day the container installed the pinned
`2.10.5-aitool.4` release (download, checksum, swap of an older folder), skipped it on a second
run, refused a wrong checksum and still refused a `PENDING-RELEASE` pin.

These checks are now in the repo: `node --test scripts/pi/player-creation.test.mjs` runs the browser
script against a fake `game` (the three settings, usage-tracking off for every user, a second run
that changes nothing), and with `PI_STAGE13_CONTAINER=1` it also runs the stage in an ARM64 Debian 13
container with stand-ins for systemd (`scripts/pi/container-test/stage13-scenarios.sh`; Docker
needed, about 30 minutes under emulation on a PC, about 30 seconds on the ARM runner; it refuses to
run outside a container): the downgrade guard, an unreadable `/api/status`, people online, the setup
screen, an install from a local zip, services that were off staying off, and a failed Assistant GM
browser start that restarts Foundry only once. CI runs both, the container part on the ARM runner,
where a missing Docker fails the step instead of skipping it.

## System trial (stage 14)

dnd5e is one folder on the Pi (`/var/lib/foundry/Data/systems/dnd5e`), shared by every world:
curse-of-strahd, strahd-kit, frostmaiden-training and pi-check all run on the version installed
there. A world migrates its data the first time it is launched on a new version, and a migrated
world does not go back. So a new dnd5e version (D-098, never on a game-night day) goes to the kit
world first, the test kit runs there, and only then does the campaign get it. The version on trial
is pinned in the script (`PIN_VERSION`, `PIN_URL` and `PIN_SHA256`, the release asset's digest on
GitHub); the first one is 6.0.6 (the Pi runs 6.0.5). A new version is a new reviewed change to those
lines.

Each mode except `status` stops Foundry for a minute or two: a `dietpi-backup 1` snapshot and your
OK first, every time. The stage checks it: a snapshot from today, and for `MODE=switch` one taken after
the trial began (the nightly one from before it does not count). From the clean main checkout on this PC, with the mode in front of `bash`:

```powershell
cat scripts/pi/remote/lib.sh scripts/pi/remote/14-system-trial.sh | ssh foundry-pi 'MODE=status bash -s'
```

- **`MODE=trial`** downloads the pinned zip (or takes `ZIP`, a `.zip` under
  `/var/lib/foundry-import/`) and checks its sha256, that its `system.json` is dnd5e at the pinned
  version and that it fits this Foundry (`compatibility.minimum` and `.maximum`). It keeps the
  installed version in `/var/lib/foundry-import/system-trial/dnd5e-<version>`, copies every world
  folder there as it is now, installs the new version and launches only `strahd-kit`. Then run the
  test kit on `strahd-kit`. **Until `switch` or `rollback`, launch no other world**, not the
  training world either: it would migrate. Stages 5-check-world, 11 and 13 refuse to run while a
  trial is open (stage 13 only for `WORLD=strahd-kit KIT_WORLD=`), and stage 5's check world never
  replaces an installed dnd5e, so a rerun after a switch keeps the new version. The Claude Desktop
  connectors see `strahd-kit` (the Assistant GM browser holds the bridge link there) until `switch`
  or `rollback`; the Kit GM takes the link while a kit session is up.
- **The test kit during a trial:** `kit-session.sh MODE=up` accepts `strahd-kit` as the launched
  world while a trial is open (phase `trial`) and records it as the world to put back, so
  `MODE=down` leaves Foundry on the kit; with any other original world `MODE=down` is refused during
  a trial. The other way round, stage 14 (every mode but `status`) refuses while a kit session is up
  (`/var/lib/foundry-ai-tool/kit-session.env` exists): run `MODE=down` first.
- **`MODE=switch`** (its own snapshot and OK) launches curse-of-strahd on the new version, which
  migrates the campaign. The training world and pi-check migrate when they are next launched. After a
  switch the stage has no roll back: going back means restoring the snapshot from before it.
- **The dnd5e migration runs in the first GM client**, here the Assistant GM browser, not when the
  server launches a world. When the new version's `flags.needsMigrationVersion` is newer than the
  launched world's `dnd5e.systemMigrationVersion` setting (or that setting is empty), `trial` and
  `switch` wait until the setting reaches the new version (read from a copy of the world's settings
  database) before they report success; a migration that does not end in `MIGRATION_WAIT` seconds
  (default 1800) counts as a failure and is put back. 6.0.6 asks for none (its
  `needsMigrationVersion` is 6.0.0), and the stage says so. When the setting cannot be read, the stage
  warns: wait until the Assistant GM browser shows no migration notice before stopping Foundry or
  taking a snapshot.
- **`MODE=rollback`** puts the old version back, resets `strahd-kit` from the trial's copy (its run
  on the new version is dropped) and launches the world Foundry ran before the trial (curse-of-strahd
  when it ran none). A world other
  than the kit that was launched during the trial (a file newer than the trial's start) is refused,
  because it may be migrated; `RESTORE_MIGRATED=1` puts it back from the copy too, losing its changes
  since. A rollback that stops halfway says so and saves where it was: run `MODE=rollback` again.

**The order on the Pi for the update to the newest (D-128; the user decides the order, and each step
is a snapshot, the user's OK and a read of the output first):**

1. `dietpi-backup 1` snapshot, then stage 14 `MODE=trial` (dnd5e 6.0.6 on `strahd-kit`).
2. Snapshot, then stage 3 with `FOUNDRY_EXPECT_VERSION=14.369` and the zip in place. The trial is
   open, so Foundry restarts on `strahd-kit`: the new Foundry meets the kit first, not the campaign.
3. `5-tool.sh` with `TOOL_REF=v0.23.0` (the tool release). `5-check-world.sh` refuses while the trial
   is open, which is expected here.
4. The test kit on `strahd-kit`: `kit-session.sh MODE=up`, `npm run kit:run -- --target pi
--not-game-night`, `MODE=down`.
5. Snapshot, then stage 14 `MODE=switch` (the campaign migrates).

A rollback after step 2 puts dnd5e 6.0.5 back under Foundry 14.369, which 6.0.5 supports.

- **`MODE=status`** is read-only: the trial's phase, the installed version, and each world's system
  version and whether it was launched since the trial began.
- **Before anything stops** the request and the trial's state are checked (a second trial, a switch
  without a trial and a rollback after a switch are refused), the zip is checked as above, the
  copies must fit (their bytes by `du -sb` against `df`: under 5 % of the disk left over stops, under
  20 % warns), and nobody may be online (the Assistant GM browser stops and `/api/status` must count
  nobody; `FORCE=1` stops Foundry anyway). One run at a time (a lock in `/var/lib/foundry-import`).
- **A failed trial or switch** puts back what ran before it (the old version, `strahd-kit` or
  curse-of-strahd from the copy, `options.json`) and starts Foundry and the Assistant GM browser as
  they were, but launches a world again only when the dnd5e folder holds the version that world runs
  on. If it does not, `options.json` launches no world, Foundry stays stopped and the stage says what
  to put back by hand. Nothing is deleted: replaced folders go to
  `/var/lib/foundry-import/prev-<time>-*`, and removing those or the trial folder needs your OK.
- **Every run is logged** in `/var/lib/foundry-import/system-trial.log`, and a dropped SSH connection
  does not stop it halfway (the stage ignores hang-up and broken-pipe signals). If a run still ends
  with the phase at `installing` or `switching` (`MODE=status`; no mode accepts those), read the log
  and restore the snapshot from before the run.

Not run on the Pi yet. With `PI_SYSTEM_TRIAL_CONTAINER=1`, `node --test scripts/pi/system-trial.test.mjs`
runs the stage in ARM64 Debian 13 containers with stand-ins for systemd and a fake Foundry that writes
into the world it opens and migrates its `world.json`
(`scripts/pi/container-test/system-trial-scenarios.sh`; Docker needed, four containers side by side,
about 20 minutes under emulation on a PC): a trial from the download and from `ZIP`, a wrong sha256, a
zip that does not fit this Foundry or holds another version, the version installed already, a second
trial, a trial that fails after the stop and undoes itself, a rollback (also one that refuses a world
launched during the trial and one with `RESTORE_MIGRATED=1`), a rollback that stops halfway and a rerun
that finishes it, the switch and a failed switch, a rollback after a switch, `status`, and people
online with and without `FORCE=1`, a trial that fails while the migration or the world start is
still running (Foundry stops before any world folder moves), and a kit session that is up
(trial, switch and rollback refused, `status` works). `kit-session-scenarios.sh` adds the kit
session during a trial. CI runs it on the ARM runner, where a missing Docker fails the step.

## Kit session (strahd-kit test run)

Before session 0 it is worth watching a real player make a character (level 1, then two level-ups to 3), as a player, on the
Pi itself. The kit session does that in the throwaway world `strahd-kit` (never
`curse-of-strahd`) and puts everything back afterwards. It is a pair of runs of one script,
`kit-session.sh`, and it needs stages 5, 11 and 13 first (the tool's build for Chromium, the GM
login in `/etc/foundry-ai-tool/world-strahd-kit.env`, and the Actor Studio fork). Take a
`dietpi-backup 1` snapshot and get your OK first: Foundry stops for a few minutes. The world
(`strahd-kit`) and the player (`Kit Player`) are fixed in the script; no variable can change them.
The in-browser part goes over first, the same way as for stage 13 (Git Bash, not PowerShell; see
there):

```bash
scp scripts/pi/remote/kit-session.mjs foundry-pi:/root/ && cat scripts/pi/remote/lib.sh scripts/pi/remote/kit-session.sh | ssh foundry-pi 'MODE=up bash -s'
```

- **`MODE=up`** checks everything before it stops anything: the world and its GM login are there, the
  tool is built, no kit session is up already, Foundry does not launch `strahd-kit` already, and
  space is fine (the 20 % rule). Then the Assistant GM browser stops, `/api/status` must answer and
  count nobody online (`FORCE=1` goes on anyway), and Foundry stops. What ran before is written to
  `/var/lib/foundry-ai-tool/kit-session.env` (mode 600) before `options.json` changes, and
  `strahd-kit`'s settings, users and actors are copied to
  `/var/lib/foundry-import/prev-<time>/worlds/strahd-kit/` (kept, never deleted). Foundry starts on
  `strahd-kit` and a headless Chromium joins as the world's GM and runs `kit-session.mjs` with
  `ACTION=setup`. It makes sure players may create actors (Player and Trusted Player are added to
  `ACTOR_CREATE`, roles already there stay), points Actor Studio at the Player's Handbook packs
  (origins for species, features and backgrounds; classes for classes and subclasses; spells, feats
  and equipment each from their own pack; the item source is left alone), turns on the standard
  array, spell selection and equipment selection and turns off manual input, point buy and rolling,
  turns usage tracking off, and creates the user `Kit Player` with no password if it is missing. An
  existing `Kit Player` must be a Player who really joins without a password (the script tries it),
  otherwise nothing is changed. Values are printed before and after, read back after a reload, and a
  second run changes nothing. When it works, Foundry stays on `strahd-kit` and the Assistant GM
  browser stays **stopped**: it would join `strahd-kit` and move the bridge link (and with it the
  Claude Desktop connectors) to the test world. The stage prints the join address
  (`http://foundry-pi:30000/join`) and the user name. If anything fails after the services stopped,
  `options.json`, Foundry and the Assistant GM browser are put back as they were and the state file
  is removed, even when the ssh session drops in the middle of the run. A run that fails after the
  world was started may leave `Kit Player` and `Kit GM` in `strahd-kit`; the stage says so, and
  `MODE=up` followed by `MODE=down` removes them.
- **The Kit GM (for the test kit's Pi target, `docs/dev/TEST-KIT.md`, "Running it on the Pi").**
  `MODE=up` also gives the kit a GM of its own, so the kit can call bridge tools against
  `strahd-kit` without anyone's login:
  - Before anything stops it also checks that stage 5's `assistant-gm.mjs`, the bridge service and
    `systemd-run` are there. A leftover password file, browser profile or running Kit GM browser from
    a cut-off run (no state file) is removed, and the stage prints what it removed.
  - The password is 16 random bytes as 32 hex characters, made on the Pi, written to
    `/etc/foundry-ai-tool/kit-gm.env` (one line `ASSISTANT_GM_PASSWORD=...`, root only, mode 600,
    through a temp file in `/etc/foundry-ai-tool` and a rename, so root never writes through a folder the
    foundry user owns) before the driver runs. It is never printed and never on a
    command line: the driver gets it in its environment, and the browser unit reads the file.
  - `ACTION=setup` also enables the `foundry-mcp-bridge` module in `strahd-kit` when it is off
    (the module stays enabled there afterwards, like the Actor Studio settings; `strahd-kit` is a
    throwaway copy), creates `Kit GM` as a Gamemaster with that password (an existing `Kit GM` is
    ours: its role and password are reset), makes it the module's **Bridge User**, reloads and reads
    it all back, and checks that a throwaway browser can really join as `Kit GM` with the password.
  - Then a transient unit `foundry-ai-tool-kit-gm-browser` (`systemd-run`, with the hardening and
    priority properties of the Assistant GM unit: low priority, no new privileges, its own profile
    folder `/var/lib/foundry-ai-tool/kit-gm-browser`, made as the foundry user) runs `assistant-gm.mjs run` as `Kit GM` with the
    canvas off, exactly like the real Assistant GM. The stage waits for "joined world strahd-kit as
    Kit GM" and then looks for the bridge link on port 31415 (a warning only). A reboot drops the
    unit and nothing starts it again. If the browser does not join, the run is rolled back like any
    other failure.
  - The state file gets a line `KIT_GM_BROWSER=1` and a line `ORIG_BRIDGE_USER=<id or empty>`, the
    Bridge User the world had before (stage 11 sets the Assistant GM there). `MODE=down` puts that
    user back when it still exists and is a GM, else "Any GM". A state file from before this change
    (no such lines) is still accepted by `MODE=down` and resets to "Any GM".
  - The PC reads the password with `pwsh scripts/pi/fetch-kit-login.ps1` (one read-only ssh command,
    nothing printed, a file limited to your Windows user). Delete it again after `MODE=down` with
    `pwsh scripts/pi/fetch-kit-login.ps1 -Remove`.
  - What the bridge writes while `strahd-kit` is connected goes to the bridge vault's own folder for
    that world (`<vault>/strahd-kit/`), not to the campaign's.
- **The player plays.** They join as `Kit Player` and make their character in Actor Studio. When they
  have left the game:

  ```bash
  cat scripts/pi/remote/lib.sh scripts/pi/remote/kit-session.sh | ssh foundry-pi 'MODE=down bash -s'
  ```

- **`MODE=down`** needs the state file, `strahd-kit` running and nobody online (`FORCE=1` goes on
  anyway). It stops the Kit GM browser first (it would count as online) and the Assistant GM browser
  too, because a reboot during the session starts that one on `strahd-kit`, where it would count as
  a user. With `strahd-kit` still running it runs `kit-session.mjs` with `ACTION=teardown`: the
  actors that `Kit Player` owns and that were made after `up` (the state file's `STAMP_EPOCH`, passed on as
  `SINCE_EPOCH`, so a DST change or a timezone change cannot move the cutoff; an older state file without it
  falls back to `STAMP` as `SINCE_STAMP`) are listed by name and id and deleted, then the user; then the
  Bridge User goes back to "Any GM" if it is `Kit GM`, and `Kit GM` is deleted. An owned actor from
  before `up` (or one with no creation time) is kept and listed as kept. At most 5
  actors are deleted; more than that stops the run (`MAX_DELETE=<n>` raises the limit after you have
  looked at them), and nothing else is deleted and no setting is touched. Any actor created for
  `Kit Player` during the session is deleted too; the copy from before the session is in
  `prev-<time>`. If the teardown fails,
  nothing else changes: Foundry stays on `strahd-kit`, the state file and the Kit GM password file
  stay and the Kit GM browser stays stopped, so `MODE=down` can run again. Otherwise the password
  file and the Kit GM browser profile are removed, Foundry stops, `options.json` launches the world
  it launched before, the state file is removed, Foundry starts, and the Assistant GM browser starts
  again if it ran before (the stage waits for "joined world").
- **Anything else as `MODE`** stops with a usage line before anything changes.

Tested the same way as stage 13: `node --test scripts/pi/kit-session.test.mjs` runs the browser
script against a fake `game` (every decision of the setup and the teardown), and with
`PI_KIT_SESSION_CONTAINER=1` it runs the stage in an ARM64 Debian 13 container with stand-ins for
systemd (`scripts/pi/container-test/kit-session-scenarios.sh`; Docker needed): up and down, the
refusals (a session already up, already on `strahd-kit`, people online, a bad `MODE`), a failing
script putting everything back, and services that were off staying off. For the Kit GM it covers the
password file (mode, form, never in the output or in any recorded call), the `systemd-run` call, a
browser that does not join, a dropped ssh session at each new step, the stop order in `MODE=down`, a
failed teardown and the old state file format; each of those scenarios is proven to fail on the
stage without the change. The first live kit session on the Pi (2026-10-13) worked: real systemd
ran the transient unit (`EnvironmentFile` of the root-only file, `ProtectSystem=full` with the
Chromium profile), Foundry took the Bridge User setting for the user made seconds before, the Kit GM
browser joined and held the bridge link, and `MODE=down` put `curse-of-strahd`, the Bridge User and
the Assistant GM browser back (about 6 minutes up, 2 down; stopping the Assistant GM browser alone
takes about 40 seconds).

`1-health.sh` (stage 1, read-only apart from its own folders) ends with a "kit session" line: a
warning "kit session up since `<STAMP>`" while `kit-session.env` exists, so a session nobody took
down (Foundry would launch `strahd-kit` on game night) shows up in the next health check.
The nightly restic backup (stage 6) leaves out the Kit GM browser profile like the Assistant GM's.

## GM scripts

Some world changes need a GM in the browser (a module's own import, a script that places map pins),
and on the Pi nobody types the Gamemaster's password. `gm-script.sh` runs one GM script in the running
world as the Assistant GM instead:

- The script is a local file on the Pi (copy it with `scp` first). It is the body of an async
  function that gets `args` (`args.dryRun`, `args.log(text)`) and returns something JSON can hold.
  Nothing over the network can start a script: no endpoint, no port, and the bridge and the
  dashboard cannot trigger it.
- **Dry run first** (`DRY_RUN=1`): only known reads go through (an allow list: document and
  compendium reads, folder listings, template loads, the server's clock and status, GET and HEAD
  requests); every other write or event is held back and listed in the log, also ones the list
  does not know. The page's guard checks the list, the script's browser checks it again on
  Foundry's socket, and the browser holds back every HTTP request that is not GET or HEAD (the one
  rule that runs outside the page). Reads work, so the script can report what it would change. A
  script should still check `args.dryRun` itself. The dry run guards against a script's mistakes;
  it is not a sandbox for a script that sets out to get around it, so read a script before you run
  it.
- **A real run needs a passed dry run of the same file** (the same sha256): `gm-script.sh` looks
  for the marker a passed dry run leaves in `/var/lib/foundry-ai-tool/gm-scripts`, or for its end
  line in the journal, and refuses otherwise. The hash is taken from the kept copy, which is the
  file that runs. A passed dry run does not expire and does not record `ENABLE_MODULES`: dry-run
  again after a long gap or with other modules. In an emergency `NO_DRY_RUN_REASON="why"` skips
  the check; the reason goes to the journal.
- `ENABLE_MODULES="id ..."` enables installed modules in the world before the script runs (a dry
  run only reports it).
- Every run is logged to the journal: the file, its sha256, dry run or not, the script's log lines
  and its result. A copy of each script stays in `/var/lib/foundry-ai-tool/gm-scripts`, named by
  time and sha256 (`<time>-<sha12>.js`, `<time>-<sha12>-dry-run.js` and, after a passed dry run,
  `<time>-<sha12>-dry-run.ok`). `journalctl -t foundry-ai-tool-gm-script` lists the runs.
- While the script runs, the Assistant GM service is stopped (one Chromium on the Pi) and **the
  bridge link is down**: the script's browser closes every WebSocket that does not go to Foundry,
  so the foundry-mcp-bridge module cannot open its link there. No AI tool call reaches the world
  during the run (the bridge has no Foundry link), and nothing the bridge sends can mix with the
  script's writes. The service starts again afterwards, also after a failure, and the link comes
  back with it.
- A run that is not a dry run changes the campaign world: a `dietpi-backup 1` snapshot and the
  user's OK come first (CLAUDE.md, the Pi rule).

```bash
scp my-script.js foundry-pi:/root/
cat scripts/pi/remote/lib.sh scripts/pi/remote/gm-script.sh | ssh foundry-pi 'GM_SCRIPT=/root/my-script.js DRY_RUN=1 bash -s'
cat scripts/pi/remote/lib.sh scripts/pi/remote/gm-script.sh | ssh foundry-pi 'GM_SCRIPT=/root/my-script.js bash -s'
```

Scripts that hold book or campaign text (room names, pin lists) stay on the PC and the Pi, never in
this repository.

## The first load after an update

After a dnd5e or Foundry update, the world migrates in the first GM browser that opens it. On the Pi
this takes several minutes for a big world, and a reload restarts it. Open the world once as GM,
wait for "Migration completed", then let the players in.

## Moving to NVMe (before real play)

microSD cards wear out and are slow under a server that writes all the time. With an M.2 NVMe SSD
(2280 size) in the Pi, Claude moves the system with DietPi's drive manager: the system runs from the
SSD and the card only starts it. That is the setup to use: DietPi offers no NVMe boot for this
board, and flashing a bootloader into the Pi's SPI flash to boot straight from the SSD has caused
boot problems for others, so it is not tried.

## Board status report (stage 16)

The Pi reports its own health to the PM board once an hour, because the PC is not always on. Stage 16
(`scripts/pi/remote/16-board-status.sh`) installs `/opt/foundry-ai-tool/status/board-status.sh` and a
systemd timer `foundry-board-status.timer` (minute 07 of every hour, and 5 minutes after boot). The script only reads the Pi and sends one JSON object: up and uptime,
disk free (the disk with Foundry's data), the last nightly backup (the result of
`foundry-backup.service` and the time of the newest restic snapshot, read with `--no-lock`), and
Foundry up or down with the Foundry and dnd5e versions from `localhost:30000/api/status`. No log
lines, no world or user names, no host name but `foundry-pi`. The board stores it and shows it on
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
  world vault is a start, so a session over midnight counts; a start older than 14 hours is stale) it stops the
  runners that run no job. A job is found through the unit's cgroup (a `Runner.Worker` process), and a running job
  is left alone, so it can delay the stop until it ends. Builds wait on GitHub's side and run when the session ends.
  Nothing marks a session by itself: it relies on `mark-play-session`. If the state cannot
  be read, the runners stay stopped for up to 6 hours in a row, then the gate lets them run and logs it. The runners are
  not enabled at boot: the gate starts them (within a minute) when no session is marked. A rerun that changes a unit
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

## Clock sync (stage 18)

DietPi's default time sync (`CONFIG_NTP_MODE=2` in `/boot/dietpi.txt`) is "boot + daily": systemd-timesyncd
syncs once, then DietPi stops it again. `timedatectl` still says "System clock synchronized: yes" (the kernel
flag stays set for some hours) but "NTP service: inactive", and the clock drifts between syncs. Cloudflare Access tokens and
the board's hourly report need a correct clock. Stage 18 (`scripts/pi/remote/18-time-sync.sh`) sets DietPi's
mode 4 (daemon + drift) with `dietpi-set_software ntpd-mode 4`, so timesyncd stays enabled and running and a
later DietPi update keeps it. DietPi's tool also rewrites `/etc/systemd/timesyncd.conf` from `CONFIG_NTP_MIRROR` (default: removes it;
a hand edit would be lost, the snapshot has it). Nothing else is touched and nothing restarts.

- **Look first (changes nothing):** `cat scripts/pi/remote/lib.sh scripts/pi/remote/18-time-sync.sh | ssh foundry-pi 'DRY_RUN=1 bash -s'`
- **Run:** after a `dietpi-backup` snapshot and the user's OK,
  `cat scripts/pi/remote/lib.sh scripts/pi/remote/18-time-sync.sh | ssh foundry-pi 'bash -s'`.
  It ends by waiting (up to 90 seconds) for "NTP service: active" and "System clock synchronized: yes".
- **Check later:** `... | ssh foundry-pi 'CHECK=1 bash -s'` or `timedatectl`.
- **Undo:** the same pipe with `UNDO=1` (back to DietPi's mode 2).
- Tests: `scripts/pi/time-sync.test.mjs` (the stage in bash with stand-ins for systemctl, timedatectl and DietPi's tool).

## Join page look (stage 19)

The page players see before they log in (`/join`) shows the world's Background Image, Join Page Theme, Next
Session and World Description; all four are world settings (Game Settings, World Configuration), no code. Stage 19
(`scripts/pi/remote/19-join-page-look.sh`) sets the picture and the description of the Curse of Strahd world on the
Pi. Join Page Theme and Next Session are not touched. The picture is campaign art: it stays on the PC and the Pi,
never in the repo or the vault.

**Why a stage and not a GM script:** World Configuration is Foundry's `editWorld` request, and while a world runs
the server accepts it only from the full Gamemaster role (`hasRole("GAMEMASTER")`, read in Foundry 14.369's setup
view). The Assistant GM has role 3 (assistant), so `gm-script.sh` cannot do it, and nobody types the GM password.
The stage therefore edits `world.json` with Foundry stopped (Foundry rewrites that file itself on exit).

- Copy the picture and the description (an HTML file) to the Pi: `scp join-bg.webp join-desc.html foundry-pi:/root/`.
- **Look first (changes nothing, needs no snapshot):**
  `cat scripts/pi/remote/lib.sh scripts/pi/remote/19-join-page-look.sh | ssh foundry-pi 'IMAGE_SRC=/root/join-bg.webp EXPECT_SHA256=<sha> DESC_FILE=/root/join-desc.html DRY_RUN=1 bash -s'`
  prints the current background and description and what would change.
- **Run:** the same without `DRY_RUN=1`, after a `dietpi-backup` snapshot and the user's OK, never on a game-night day.
  It refuses while players are online or a recording runs, saves the old values to
  `/var/lib/foundry-ai-tool/join-page-look/<time>-<world>-before.json`, stops the Assistant GM browser and Foundry,
  installs the picture as `worlds/curse-of-strahd/join-background.webp` (foundry user, mode 644), sets `background` and
  `description` in `world.json`, starts Foundry, waits for the join page, starts the Assistant GM browser and checks
  that `/join` names the picture and the picture is served. A failure after the stop puts `world.json` back and starts
  both services again. The same picture and description again change nothing.
- **Another description later** (Danni sends his own): change the HTML file and run it again.
- **Undo:** the same pipe with `UNDO=1` (and `EXPECT_SHA256`): the old description comes back, the background key is
  removed when it was not set before, and the picture is deleted when it still has that hash.
- Check the result logged out (a private window), reload once. Tests: `scripts/pi/join-page-look.test.mjs`.

## Where things live on the Pi

| What                                                         | Where                                                                                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Foundry program                                              | `/opt/foundry`                                                                                                             |
| Foundry data (worlds, modules, assets)                       | `/var/lib/foundry`                                                                                                         |
| Node.js                                                      | `/opt/node24`                                                                                                              |
| The tool (release builds)                                    | `/opt/foundry-ai-tool`                                                                                                     |
| Settings and secrets for the tool                            | `/etc/foundry-ai-tool/.env` (readable by root and the service only)                                                        |
| The tool's storage (bridge vault)                            | `/var/lib/foundry-ai-tool`                                                                                                 |
| Backups                                                      | restic repository `/var/lib/foundry-backup/restic` (the PC copy: `E:\PiBackup\restic`)                                     |
| Recorder bot                                                 | `/opt/foundry-ai-tool/discord-bot` (service `foundry-ai-tool-discord-bot`)                                                 |
| Recordings (until this PC has copied them, then 7 more days) | `/var/lib/foundry-ai-tool/recordings`                                                                                      |
| GM vault (Syncthing shares it)                               | `/var/lib/foundry-ai-tool/obsidian/gm`                                                                                     |
| Space check status (hourly)                                  | `/var/lib/foundry-ai-tool/space/status.json`                                                                               |
| Board status report (stage 16): script, token file, timer    | `/opt/foundry-ai-tool/status/board-status.sh`, `/etc/foundry-ai-tool/board-status.conf`, `foundry-board-status.timer`      |
| GitHub runners for the PM board (stage 17): runners, gate    | `/opt/gh-runner/{vault,board}`, `/opt/gh-runner/gate.sh`, `foundry-ai-tool-gh-runner-{vault,board}.service`, `-gate.timer` |
| When this PC last copied the backups (restic, snapshot)      | `/var/lib/foundry-backup-pulls/<kind>.json`                                                                                |
| A dnd5e trial (the old version, world copies; stage 14)      | `/var/lib/foundry-import/system-trial`                                                                                     |

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
