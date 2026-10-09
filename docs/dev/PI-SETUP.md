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
- **Part C, later: players and the GM from outside** through Cloudflare. Only after the dashboard
  checks Cloudflare's signed login token (vault idea I-022). Your steps:
  [Remote access, Part C](REMOTE-ACCESS.md#part-c-players-and-the-gm-reach-the-orange-pi-through-cloudflare);
  Claude's side is stage 12 below.

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

| Stage           | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Needs you                                                                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Health check | Updates, disk, memory, temperature, clock and time zone; a `foundry` system user and the folders below (`scripts/pi/remote/1-health.sh`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | no                                                                                                                                                                                                                                 |
| 2. Node.js      | Node 24 LTS (Foundry 14 requires it) for ARM64 from nodejs.org, checksum-checked against `SHASUMS256.txt`, in `/opt/node24` (`2-node.sh`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | no                                                                                                                                                                                                                                 |
| 3. Foundry      | Installed as a service on port 30000, data in `/var/lib/foundry`, reachable at `http://foundry-pi.local:30000` from home; started with `--noupnp`, so Foundry never asks the router to open a port (`3-foundry.sh`)                                                                                                                                                                                                                                                                                                                                                                                             | **yes:** download the **Linux/Node.js** build from your foundryvtt.com account on this PC (the link lasts 5 minutes; Claude copies the file over), then enter the licence key and an admin password in your browser on first start |
| 4. Tailscale    | Private admin access: SSH and the bridge from this PC, also when you are away from home. For you only, not the players (D-075). From Tailscale's own apt repository (`4-tailscale.sh`). Tailscale DNS is off on the Pi, so names come from the router (with it on, a DHCP lease renewal left the Pi with no public lookups)                                                                                                                                                                                                                                                                                     | **yes:** open the login link Claude shows, and install Tailscale on this PC with the same account                                                                                                                                  |
| 5. The tool     | Bridge and dashboard as services, built on the Pi from a release tag (`5-tool.sh`, default `v0.21.0`), the module copied into Foundry from the same build; a Chromium browser without a screen, logged into Foundry as a dedicated Assistant GM user (role Assistant, so the human GM stays the primary GM) and set as the bridge's user, so the tool works when no human GM is online; everything on loopback, the control port and the dashboard shared with the tailnet only (Tailscale serve). `5-check-world.sh` proves the chain in a throwaway world `pi-check`                                          | **yes:** OK the stage; OK Claude switching the five Claude Desktop entries on this PC to the Pi (Claude Desktop restarts, which cuts Claude Code sessions in the app)                                                              |
| 6. Backups      | Nightly restic backup at 04:30 on the Pi (`6-backup.sh`): `/var/lib/foundry` (worlds, modules), the tool's storage and `/etc/foundry-ai-tool` (secrets), without logs, the browser profile and recordings; Foundry stops for a minute or two while it runs; 7 daily kept on the Pi. This PC copies it every day into `E:\PiBackup\restic` (`pull-restic.ps1`): 14 daily, 8 weekly, 12 monthly, plus a monthly test restore. Also installs `record-pull.sh`, which the PC's two pull scripts call after each good copy so the Discord bot can DM you when no copy arrived for 3 days (see "Stale backup copies") | **yes:** store the PC repository's password (`%APPDATA%\foundry-ai-tool\restic-pc.pass`, made on the first copy) in your password manager: without it the copies cannot be read                                                    |
| 7. Vault sync   | Syncthing (Debian's, as its own service `foundry-ai-tool-syncthing`, files in `/var/lib/foundry-ai-tool/syncthing`) shares the GM vault with the GM's PC (and this PC, for checking) (`7-vault.sh`). The bridge writes the vault to `/var/lib/foundry-ai-tool/obsidian/gm` (`bridge.env`: `FOUNDRY_AI_OBSIDIAN_DIR`, `FOUNDRY_AI_OPEN_BASE`, `FOUNDRY_AI_FOUNDRY_URL`); relays on, UPnP off, GUI on loopback. The Foundry mirror switch stays off (a GM decision per world). The player vault waits for O7 (D-091)                                                                                              | **yes:** on each receiving PC run `scripts/pi/setup-syncthing-pc.ps1` (or accept the Pi in the Syncthing GUI), then give Claude that PC's device ID                                                                                |
| 8. Discord bot  | The recorder bot as a service (`8-recorder.sh`: `foundry-ai-tool-discord-bot`, runs as `foundry`, from the stage 5 build, so it shares the tool version; run it again after a new stage 5 build), recordings in `/var/lib/foundry-ai-tool/recordings`; this PC copies finished recordings over Tailscale for transcription. The service stays off until the token is in                                                                                                                                                                                                                                         | **yes:** run `scripts/pi/set-discord-token.ps1` on this PC and paste the bot token from the Discord developer page (not shown on screen; Claude never sees it); it starts the bot                                                  |
| 9. Command log  | Every SSH login with the PC's key goes through a small logger (`9-ssh-log.sh`: a `command=` prefix on the key line in `/root/.ssh/authorized_keys`, `sshd_config` untouched): one line per command in `/var/lib/foundry-ai-tool/ssh-log/ssh-commands.log`, plus a copy of every stage script; root only, 12 weeks kept; the token script is logged by name only. A logging error never blocks the command. A 5-minute safety timer restores the old key file unless a new connection confirms                                                                                                                   | **yes:** your OK (an SSH change), and default permission mode while it runs                                                                                                                                                        |
| 10. Space check | An hourly storage check (`10-space-check.sh`: `foundry-space-check.timer`, the checker in `/opt/foundry-ai-tool/space`) of every disk the backups, snapshots, the vault sync and the recordings use, written to `/var/lib/foundry-ai-tool/space/status.json` (below 20 % free is low, below 5 % is critical) and as a warning line in the journal. The nightly restic backup (stage 6) runs the check first: below 20 % it still runs, at critical it is skipped. `UNDO=1` removes it                                                                                                                           | **yes:** your OK (a new service and timer); then run stage 6 again so the backup gets its pre-check                                                                                                                                |
| 11. World       | `11-world.sh` installs the bundle `push-world.ps1` built on this PC, after checking the tar and every checksum: the campaign world, its private modules and image folders. An existing campaign world is kept unless `REPLACE_WORLD=1`; a test copy `strahd-kit` is reset every time; old copies go to `/var/lib/foundry-import/prev-<time>`, never deleted. Each world gets a generated GM password (`/etc/foundry-ai-tool/world-<id>.env`) and is provisioned like stage 5. See "Licensed content"                                                                                                            | **yes:** your OK (Foundry stops for a few minutes), after a `dietpi-backup 1` snapshot                                                                                                                                             |
| 12. Tunnel      | Part C (D-075): Cloudflare Tunnel, so players reach Foundry and the GM the dashboard through Cloudflare Access with no router port open (`12-tunnel.sh`). `cloudflared` from Cloudflare's signed apt repository (key pinned), service `foundry-ai-tool-cloudflared` in token mode: a root-only token file read through systemd `LoadCredential`, never an argument or environment variable; no token, no start. `FOUNDRY_PUBLIC_HOST=play.<domain>` sets Foundry's `hostname`, `proxySSL`, `proxyPort` 443. No firewall, SSH, network or Tailscale change                                                       | **yes:** your OK and a snapshot; then run `set-tunnel-token.sh` yourself over SSH                                                                                                                                                  |

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

Copy a restored world to the Pi only with Foundry stopped, and keep the owner `foundry:foundry`
(`chown -R foundry:foundry` on the world folder); both steps need your OK under the Pi safety rule.

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
   new connection described in its header), then `systemctl start foundry`. The worlds (with their
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
`/var/lib/foundry-ai-tool/syncthing`, never in Foundry's data folder). Syncthing keeps the folder
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

## Part C: players and the GM from outside (later)

Players reach Foundry through a Cloudflare Tunnel with Cloudflare Access in front (D-075). They
install nothing and join no private network: they open a normal web address and confirm their email
with a one-time code about once a month. Foundry's login page is never open to the internet, and no
router ports are opened (the tunnel dials out).

**Before Part C:** the dashboard must check Cloudflare Access's signed token instead of trusting the
email header (vault idea I-022). Claude builds that first.

What you do:

1. **Buy a domain** you like through Cloudflare Registrar (sold at cost, about 10 USD a year), so its
   DNS is at Cloudflare from the start. Claude never handles payment or logins.
2. **Create a free Cloudflare account** (Access is free for small teams), and in Zero Trust,
   Settings, Authentication, **add "One-time PIN"** as a login method (new accounts no longer have
   it switched on).
3. **Enter the players' and the GM's email addresses** in the Access policy (they stay out of the repo
   and the vault).
4. **Log in once** when Claude creates the tunnel on the Pi (a browser link).

What Claude does: installs `cloudflared` on the Pi as a service (from Cloudflare's apt repository,
with its current signing key); routes `foundry.<your domain>` to
Foundry and `cogm.<your domain>` to the dashboard (GM emails only); sets Access to email one-time
codes; sets Foundry's proxy options for the domain; and tests both from outside before anyone gets
the address. Templates: `deploy/cloudflare/`; background: [Remote access](REMOTE-ACCESS.md).

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

If a proxy ever has to run elsewhere, it is our patched copy (it reads the cookie from a file and
keeps it out of its logs), bound to `127.0.0.1`, never the upstream one (which logs the cookie).

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

## Where things live on the Pi

| What                                                         | Where                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Foundry program                                              | `/opt/foundry`                                                                         |
| Foundry data (worlds, modules, assets)                       | `/var/lib/foundry`                                                                     |
| Node.js                                                      | `/opt/node24`                                                                          |
| The tool (release builds)                                    | `/opt/foundry-ai-tool`                                                                 |
| Settings and secrets for the tool                            | `/etc/foundry-ai-tool/.env` (readable by root and the service only)                    |
| The tool's storage (bridge vault)                            | `/var/lib/foundry-ai-tool`                                                             |
| Backups                                                      | restic repository `/var/lib/foundry-backup/restic` (the PC copy: `E:\PiBackup\restic`) |
| Recorder bot                                                 | `/opt/foundry-ai-tool/discord-bot` (service `foundry-ai-tool-discord-bot`)             |
| Recordings (until this PC has copied them, then 7 more days) | `/var/lib/foundry-ai-tool/recordings`                                                  |
| GM vault (Syncthing shares it)                               | `/var/lib/foundry-ai-tool/obsidian/gm`                                                 |
| Space check status (hourly)                                  | `/var/lib/foundry-ai-tool/space/status.json`                                           |
| When this PC last copied the backups (restic, snapshot)      | `/var/lib/foundry-backup-pulls/<kind>.json`                                            |

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
