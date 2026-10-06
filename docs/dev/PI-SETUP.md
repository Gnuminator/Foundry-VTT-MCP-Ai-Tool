---
title: Orange Pi setup
description: Bring up the Orange Pi 5 Pro from scratch as the home server for Foundry, the tool, backups and the Discord bot, with as much automation as possible.
---

# Orange Pi setup

The Orange Pi 5 Pro (16 GB) becomes the always-on home server: Foundry VTT itself, the bridge, the
co-GM dashboard, the Discord bot, backups and vault sync. Decisions: vault notes D-068 (the Pi),
D-075 (how players reach it).

How the work is split:

- **Part A, you (about 30 minutes, today):** prepare a microSD card on this PC, plug the Pi in, run
  one script. After that this PC can reach the Pi over SSH. Checked against DietPi's current image
  on 2026-10-04.
- **Part B, Claude (over SSH from this PC):** the system, Node.js, Foundry, private admin access,
  the tool, backups and vault sync, in stages. Claude stops before each stage and at the few steps
  only you can do (licence key, logins in your browser).
- **Part C, later: players and the GM from outside** through Cloudflare. Only after the dashboard
  checks Cloudflare's signed login token (vault idea I-022).

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

| Stage           | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Needs you                                                                                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Health check | Updates, disk, memory, temperature, clock and time zone; a `foundry` system user and the folders below (`scripts/pi/remote/1-health.sh`)                                                                                                                                                                                                                                                                                                                                                                                                                               | no                                                                                                                                                                                                                                 |
| 2. Node.js      | Node 24 LTS (Foundry 14 requires it) for ARM64 from nodejs.org, checksum-checked against `SHASUMS256.txt`, in `/opt/node24` (`2-node.sh`)                                                                                                                                                                                                                                                                                                                                                                                                                              | no                                                                                                                                                                                                                                 |
| 3. Foundry      | Installed as a service on port 30000, data in `/var/lib/foundry`, reachable at `http://foundry-pi.local:30000` from home; started with `--noupnp`, so Foundry never asks the router to open a port (`3-foundry.sh`)                                                                                                                                                                                                                                                                                                                                                    | **yes:** download the **Linux/Node.js** build from your foundryvtt.com account on this PC (the link lasts 5 minutes; Claude copies the file over), then enter the licence key and an admin password in your browser on first start |
| 4. Tailscale    | Private admin access: SSH and the bridge from this PC, also when you are away from home. For you only, not the players (D-075). From Tailscale's own apt repository (`4-tailscale.sh`)                                                                                                                                                                                                                                                                                                                                                                                 | **yes:** open the login link Claude shows, and install Tailscale on this PC with the same account                                                                                                                                  |
| 5. The tool     | Bridge and dashboard as services, built on the Pi from a release tag (`5-tool.sh`, default `v0.21.0`), the module copied into Foundry from the same build; a Chromium browser without a screen, logged into Foundry as a dedicated Assistant GM user (role Assistant, so the human GM stays the primary GM) and set as the bridge's user, so the tool works when no human GM is online; everything on loopback, the control port and the dashboard shared with the tailnet only (Tailscale serve). `5-check-world.sh` proves the chain in a throwaway world `pi-check` | **yes:** OK the stage; OK Claude switching the five Claude Desktop entries on this PC to the Pi (Claude Desktop restarts, which cuts Claude Code sessions in the app)                                                              |
| 6. Backups      | Nightly restic backup at 04:30 on the Pi (`6-backup.sh`): `/var/lib/foundry` (worlds, modules), the tool's storage and `/etc/foundry-ai-tool` (secrets), without logs, the browser profile and recordings; Foundry stops for a minute or two while it runs; 7 daily kept on the Pi. This PC copies it every day into `E:\PiBackup\restic` (`pull-restic.ps1`): 14 daily, 8 weekly, 12 monthly, plus a monthly test restore                                                                                                                                             | **yes:** store the PC repository's password (`%APPDATA%\foundry-ai-tool\restic-pc.pass`, made on the first copy) in your password manager: without it the copies cannot be read                                                    |
| 7. Vault sync   | Syncthing (Debian's, as its own service `foundry-ai-tool-syncthing`, files in `/var/lib/foundry-ai-tool/syncthing`) shares the GM vault with the GM's PC (and this PC, for checking) (`7-vault.sh`). The bridge writes the vault to `/var/lib/foundry-ai-tool/obsidian/gm` (`bridge.env`: `FOUNDRY_AI_OBSIDIAN_DIR`, `FOUNDRY_AI_OPEN_BASE`, `FOUNDRY_AI_FOUNDRY_URL`); relays on, UPnP off, GUI on loopback. The Foundry mirror switch stays off (a GM decision per world). The player vault waits for O7 (D-091)                                                     | **yes:** on each receiving PC run `scripts/pi/setup-syncthing-pc.ps1` (or accept the Pi in the Syncthing GUI), then give Claude that PC's device ID                                                                                |
| 8. Discord bot  | The recorder bot as a service (`8-recorder.sh`: `foundry-ai-tool-discord-bot`, runs as `foundry`, from the stage 5 build, so it shares the tool version; run it again after a new stage 5 build), recordings in `/var/lib/foundry-ai-tool/recordings`; this PC copies finished recordings over Tailscale for transcription. The service stays off until the token is in                                                                                                                                                                                                | **yes:** run `scripts/pi/set-discord-token.ps1` on this PC and paste the bot token from the Discord developer page (not shown on screen; Claude never sees it); it starts the bot                                                  |
| 9. Command log  | Every SSH login with the PC's key goes through a small logger (`9-ssh-log.sh`: a `command=` prefix on the key line in `/root/.ssh/authorized_keys`, `sshd_config` untouched): one line per command in `/var/lib/foundry-ai-tool/ssh-log/ssh-commands.log`, plus a copy of every stage script; root only, 12 weeks kept; the token script is logged by name only. A logging error never blocks the command. A 5-minute safety timer restores the old key file unless a new connection confirms                                                                          | **yes:** your OK (an SSH change), and default permission mode while it runs                                                                                                                                                        |
| 10. Space check | An hourly storage check (`10-space-check.sh`: `foundry-space-check.timer`, the checker in `/opt/foundry-ai-tool/space`) of every disk the backups, snapshots, the vault sync and the recordings use, written to `/var/lib/foundry-ai-tool/space/status.json` (below 20 % free is low, below 5 % is critical) and as a warning line in the journal. The nightly restic backup (stage 6) runs the check first: below 20 % it still runs, at critical it is skipped. `UNDO=1` removes it                                                                                  | **yes:** your OK (a new service and timer); then run stage 6 again so the backup gets its pre-check                                                                                                                                |

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
documents; only panning and measuring fall back). It reads its user name and password from
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
critical: under 5 % free, or (for the nightly restic backup) less free space than the data it backs
up. A full disk is the quiet way a backup chain stops working, so the warning has to reach someone.

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
in the status file, runs anyway below 20 %, and at critical (disks that hold its sources or the
repository, or less free than the data it would back up) exits without stopping Foundry, with the
message "backup skipped: disk space is critical" in `journalctl -u foundry-backup`. Run stage 6 again
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
the Pi; the Pi deletes copied recordings after 7 days. The recorded audio on this PC is deleted 14
days after the GM approves the session's notes (D-072). Details:
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
another machine. Import on the PC (the proxy and Adventure Muncher against the PC's Foundry), then
Claude copies the results to the Pi with Foundry stopped:

- the private content module (`Data/modules/aitool-content`, its images inside, D-084);
- the adventure images and files, which live outside the world: `Data/ddb-images/` and
  `Data/ddb-adventure/`;
- token art from an older world: `Data/tokenizer/` (without it, tokens show broken images).

If a proxy ever has to run elsewhere, it is our patched copy (it reads the cookie from a file and
keeps it out of its logs), bound to `127.0.0.1`, never the upstream one (which logs the cookie).

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
