---
title: Backups, drills and storage
description: Snapshots and restic copies on this PC, stale copies, the rebuild drill, the NVMe move and the storage space check.
---

# Backups, drills and storage

Part of [PI-SETUP](../PI-SETUP.md).

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
/mnt/dietpi-backup`), then run `dietpi-backup -1`. With card plus SSD (see "Moving to NVMe") read
"Which part was lost" there first: a restore must not be run on a fresh card without it.

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

If the Pi itself is down on game night, these copies are what [Plan B](../PLAN-B.md) runs Foundry from on
this PC.

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

What the snapshot record means: it says "this PC has a fresh snapshot". When the newest snapshot on
the Pi is older than `WarnAfterDays` (3), `pull-snapshot.ps1` and `pull-restic.ps1` log a WARNING and
leave the record alone, so if `dietpi-backup` itself stops on the Pi the record ages and the same DM
fires (about 6 days after the last good backup: 3 days until the snapshot counts as stale, then the
3-day record limit). The DM text only says the copy is old; it cannot tell "the PC did not copy" from
"the Pi made no new backup", so look at `E:\PiBackup\logs` for the WARNING line.

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
off). `FOUNDRY_AI_DASHBOARD_URL` (default `http://127.0.0.1:3100`; on the Pi the dashboard is on 3000, and stage 26 writes `http://127.0.0.1:3000` into the file when you give it `PLAYER_PAGE_URL`) is where the bot reads the session
flag and `FOUNDRY_AI_PLAYER_TOKEN` is the dashboard's player token if one is set. A session that
ends while the bot is down is not announced. The bot posts the link to everyone who can read that
channel, so if `FOUNDRY_AI_PLAYER_PAGE_URL` carries a `?token=` (the player token), post only to a
channel that holds nothing but players; never to one where non-players can read it.

Health line dots (item health-line-dots, off by default): the GM health line can show a Recorder dot
(a speaker silent for 5 minutes, a failed audio stream, the bot unable to rejoin) and a Play log dot.
For the Recorder dot, set `FOUNDRY_AI_BOT_STATUS_PORT` (for example `3110`) in the bot's env file;
the bot then answers `GET /status` with a small JSON document (is a recording running, what is
wrong), no audio and no secrets. It listens on `127.0.0.1` unless `FOUNDRY_AI_BOT_STATUS_HOST` names
another address; keep it on the Pi or the Pi network, never forwarded to the internet. In the
dashboard's environment set `DASHBOARD_BOT_STATUS_URL=http://127.0.0.1:3110/status`. With a URL set,
a bot that does not answer shows "Recorder unknown" (grey), never OK, even when no recording runs
(a bot that is down is down); without a URL there is no Recorder dot. A port that is not a number
from 1 to 65535, or one already in use, is named in the bot's log and leaves the endpoint off. The Play log dot needs no setting.

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

1. Part A with a new card (this is the case "both lost" in "Moving to NVMe", "Which part was lost":
   if only the card or only the SSD died, follow that section instead; after a full rebuild redo the
   move once the restore is done). The host name must be `foundry-pi`: the Foundry licence in the backup is
   bound to it and fails verification under any other name. A new card has a new SSH host key, so
   first clear the old one on this PC (`ssh-keygen -R foundry-pi`, and the same for the Tailscale
   name and the address you use), or SSH refuses with "host key changed".
2. Stages 1, 2 and 3 (stage 3 needs the Linux/Node.js zip again: keep `FoundryVTT-Node-14.370.zip`
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

## Moving to NVMe (done 2026-10-30)

microSD cards wear out and are slow under a server that writes all the time, so the Pi's system runs
from an M.2 NVMe SSD (Samsung 512 GB, 2280, PCIe: one notch, M key; two notches is M.2 SATA and will not
work). The card only starts it. DietPi's "Transfer RootFS" is not offered on the Orange Pi 5 Pro (its
drive manager allows it only on Raspberry Pis and some Odroids), and flashing a bootloader into the
Pi's SPI flash has caused boot problems for others, so the move is done by hand. The card keeps
`/boot` (u-boot reads `/boot/dietpiEnv.txt` from it) and its old system stays untouched on it.

### How it is set up now

- `/` is the SSD's one ext4 partition (label `nvme-root`). `/boot/dietpiEnv.txt` on the card says
  `rootdev=UUID=<SSD partition>`; the old file is kept as `/boot/dietpiEnv.txt.card`.
- `/etc/fstab` mounts the card's partition at `/mnt/card` and binds `/mnt/card/boot` onto `/boot`, so
  kernel and u-boot files that apt or DietPi write land on the card, where u-boot reads them. The
  fstab before the move is kept as `/etc/fstab.card`.
- `dietpi-backup` snapshots, the restic repository and Foundry's data are all on the SSD now. The
  card's old copy of them is a frozen state from 2026-10-30 and is not updated.

**Redoing the move** (each step that changes the Pi needs your OK; the guard stops a session from
formatting a disk, so step 2 you run yourself):

1. `dietpi-backup 1`, power off, fit the SSD, power on (`lsblk` shows `nvme0n1`). The services start
   again at boot, so stop them now: Foundry, every `foundry-ai-tool-*` service (Syncthing and
   cloudflared included) and `foundry-backup.timer`, so nothing writes to the card during the copy.
   Stay clear of the nightly `dietpi-backup` (01:25) and the restic job (04:30); after step 3 run
   `rsync` once more with `--delete` right before the reboot of step 4.
2. Check before you wipe (this destroys the SSD's content, so look at it first): `findmnt -no SOURCE /`
   must show `mmcblk1p1` (on the current Pi it shows `nvme0n1p1`: stop, nothing to redo), and
   `lsblk -f /dev/nvme0n1` shows what the SSD holds (mount a data partition read-only and list it);
   only an OK on that list lets you go on. Then format (you run this, the guard blocks a session):
   `wipefs -a` on each `/dev/nvme0n1p*` that exists, then `wipefs -a /dev/nvme0n1`, then
   `parted -s /dev/nvme0n1 mklabel gpt mkpart root ext4 1MiB 100%`, then
   `mkfs.ext4 -q -L nvme-root /dev/nvme0n1p1`.
3. Copy the system: mount the SSD at `/mnt/ssdroot`, bind-mount `/` at `/mnt/cardroot` (so the tmpfs
   folders are left out), then
   `rsync -aHAX --numeric-ids --exclude=/mnt/ssdroot --exclude=/mnt/cardroot /mnt/cardroot/ /mnt/ssdroot/`
   (about 18 GB, 10 to 15 minutes from the card).
4. In `/mnt/ssdroot/etc/fstab` point `/` at the SSD's UUID, and add the card at `/mnt/card` and
   `/mnt/card/boot /boot none bind,x-systemd.requires-mounts-for=/mnt/card 0 0`. In the card's
   `/boot/dietpiEnv.txt` set `rootdev=UUID=<SSD partition>`. Reboot. The working fstab has these
   three lines: `UUID=<SSD> / ext4 noatime,lazytime,rw 0 1`,
   `UUID=<card> /mnt/card ext4 noatime,lazytime,rw 0 2` and the bind line above.
5. Check: `findmnt /` shows `/dev/nvme0n1p1`, `/boot` and `/mnt/card` show the card, no failed units,
   Foundry on 30000, the dashboard on 3000, the bridge link up, the tunnel, the recorder bot and the
   nightly `foundry-backup.timer`.

This procedure is by hand, a recorded one-off (D-133): each command is shown to the user before it
runs, and turning steps 3 to 5 into a reviewed stage script is not done.

**If it does not boot:** the kernel waits for the root and there is no serial console. A monitor and
keyboard on the Pi (HDMI) show where it waits; if it drops to an initramfs shell, mount the card
there and fix `rootdev` in `dietpiEnv.txt`. Otherwise revert `rootdev` in `/boot/dietpiEnv.txt` on the
card to the card's UUID (as in `dietpiEnv.txt.card`) from a Linux machine that can read ext4 (this PC
is Windows and cannot), and the card boots its old system again. Without one, boot a second, freshly
flashed card (Part A; never reflash the original, it holds the frozen fallback system): from there
mount the SSD, put that card's UUID into the SSD's `/etc/fstab` (the `/mnt/card` line), and set
`rootdev` on that card to the SSD's UUID.

### Which part was lost

- **Card lost, SSD fine:** no snapshot restore. Boot a freshly flashed card (Part A), then as above:
  mount the SSD, put the new card's UUID into its fstab (until that is done `/boot` fails to mount
  and the Pi stops in emergency mode), and `rootdev` on the new card to the SSD's UUID. Separately,
  the new card's kernel must match the SSD's `/lib/modules`: copy `/boot` (kernel, initrd, dtb) from
  the SSD's newest post-move snapshot (`data/boot/`) onto the new card, keep the new card's own
  `dietpiEnv.txt` with the SSD `rootdev` (a mismatch shows as missing modules, possibly no network).
  `nofail` on the `/mnt/card` line would boot with a stale `/boot` instead of stopping, so kernel
  updates could land on the SSD unseen; it is not set.
- **SSD lost, card fine:** the card's old system boots after reverting `rootdev`, but only until the
  first kernel update after the move: later kernels and their initrd are on the card's `/boot` while
  their `/lib/modules` are only on the SSD, so the old system can boot a kernel with no matching
  modules (a missing Ethernet driver means no network). The snapshots on the SSD are gone too: the
  copies are in `E:\PiBackup\snapshots` on the PC, and this PC cannot write the card's ext4. So keep
  the card ready ahead of time: after every kernel update, with the SSD system running and the
  user's OK, `rsync -a /lib/modules/ /mnt/card/lib/modules/`. If that was not done, boot a second,
  freshly flashed card, mount the old card there and copy the modules from the PC archive. Then
  restore the newest snapshot and redo the move with a new SSD.
- **Both lost:** Part A on a new card, the `dietpi-backup` or restic restore, then redo the move.

**Snapshots across the move:** `dietpi-backup` copies `/` (with the card's `/boot` visible through the
bind) and skips `/mnt/*`, so `/mnt/card` is not swept in, and the snapshot holds the card's
`dietpiEnv.txt` and the SSD's fstab. Restore a snapshot from after 2026-10-30 19:48 where you can. One
from before has the card as `/` in its fstab and `rootdev`; `dietpi-backup -1` warns that the UUIDs
differ and rewrites the root UUID, but it knows nothing of the `/mnt/card` and `/boot` lines and
removes `/etc/fstab.card` and, through the bind, the card's `/boot/dietpiEnv.txt.card`. Before such a
restore note the card's UUID (`blkid` on the card partition) somewhere outside `/` and `/boot`. After
it put back the three fstab lines from step 4 and check `rootdev` in `/boot/dietpiEnv.txt` before
rebooting, or the next kernel update lands on the SSD's own
`/boot`, where u-boot never reads it.
