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
- For backups (can come later): a USB hard drive **with its own power supply** (or on a powered USB
  hub). A drive powered only by the Pi's USB port can drop out at spin-up.
- Fallback only: a monitor with an HDMI cable and a USB keyboard, if the Pi cannot be found on the
  network.

## On your PC

| What                                          | When            | Check                                                                                |
| --------------------------------------------- | --------------- | ------------------------------------------------------------------------------------ |
| PowerShell 7                                  | Part A          | `$PSVersionTable.PSVersion` shows 7 or newer (`winget install Microsoft.PowerShell`) |
| The Windows OpenSSH client                    | Part A          | `ssh -V` answers (Settings, Optional features, "OpenSSH Client")                     |
| [balenaEtcher](https://etcher.balena.io)      | Part A          | writes the image to the card                                                         |
| [Tailscale](https://tailscale.com/download)   | Part B, stage 4 | you log in once; this PC then reaches the Pi privately                               |
| Claude Desktop, pointed at the Pi's bridge    | Part B, stage 5 | Claude changes its five entries with your OK (see stage 5)                           |
| [Syncthing](https://syncthing.net/downloads/) | Part B, stage 7 | only if you want the vaults synced to this PC                                        |

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

Open balenaEtcher, choose the downloaded `.img.xz` file, choose the microSD card, click **Flash**.
Double-check the target: Etcher erases it.

### 3. Put the settings on the card

When Etcher is done, take the card out and put it back in. Windows shows a small drive named
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

Optional but useful: in your router, give the Pi a fixed address (a "DHCP reservation"), so it keeps
the same address after restarts.

If the script cannot find the Pi after 20 minutes: plug in the monitor and keyboard, log in as `root`
with the password from `~\.foundry-pi\root-password.txt`, and run `hostname -I` to see its address.
Then run `.\scripts\pi\find-pi.ps1 -Address <that address>`.

## Part B: Claude

Claude works over `ssh foundry-pi` and pauses before each stage. Where you are needed, it says so.
Each stage ends with a check Claude shows you (a service running, a page answering, a backup
listed).

| Stage           | What happens                                                                                                                                                                                                                                                                      | Needs you                                                                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Health check | Updates, disk, temperature, clock and time zone; a `foundry` system user and the folders below; the firewall allows SSH and Foundry from the home network only                                                                                                                    | no                                                                                                                                                                                                                                 |
| 2. Node.js      | Node 24 LTS (Foundry 14 requires it) for ARM64 from nodejs.org, checksum-checked against `SHASUMS256.txt`, in `/opt/node24`                                                                                                                                                       | no                                                                                                                                                                                                                                 |
| 3. Foundry      | Installed as a service on port 30000, data in `/var/lib/foundry`; reachable at `http://foundry-pi.local:30000` from home                                                                                                                                                          | **yes:** download the **Linux/Node.js** build from your foundryvtt.com account on this PC (the link lasts 5 minutes; Claude copies the file over), then enter the licence key and an admin password in your browser on first start |
| 4. Tailscale    | Private admin access: SSH and the bridge from this PC, also when you are away from home. For you only, not the players (D-075)                                                                                                                                                    | **yes:** open the login link Claude shows, and install Tailscale on this PC with the same account                                                                                                                                  |
| 5. The tool     | Bridge and dashboard as services (released builds); a Chromium browser without a screen, logged into Foundry as a dedicated Assistant GM user and set as the bridge's user, so the tool works when no human GM is online; the bridge's control port only on the Tailscale address | **yes:** create the Assistant GM user in Foundry and paste its password once when Claude asks; OK Claude switching the five Claude Desktop entries on this PC to the Pi                                                            |
| 6. Backups      | Nightly snapshots (restic) at 05:00 to the USB drive: Foundry data, the tool's storage, the Obsidian vaults. Keeps 14 daily, 8 weekly, 12 monthly; a monthly test restore                                                                                                         | plug in the drive                                                                                                                                                                                                                  |
| 7. Vault sync   | Syncthing: the GM vault to the GM's PC, the player vault to anyone who wants the Obsidian app                                                                                                                                                                                     | accept the device on each PC                                                                                                                                                                                                       |
| 8. Discord bot  | The recorder bot as a service                                                                                                                                                                                                                                                     | a bot token from the Discord developer page, pasted by you                                                                                                                                                                         |

Stage 5 in more detail, because it changes how Claude Desktop reaches the game: each entry in
`%APPDATA%\Claude\claude_desktop_config.json` gets `MCP_CONTROL_HOST` set to the Pi's Tailscale name
and `MCP_NO_SPAWN` set to `1` (see [Deployment](DEPLOYMENT.md#pointing-claude-desktop-at-a-bridge-that-runs-elsewhere)).
The bridge's control port has no login of its own (vault idea I-023), so it listens only on the
Pi's Tailscale address and loopback, never on the home network or the internet. The Foundry
module's "bridge user" setting names the Assistant GM user, so the GM's own browser never tries to
run the bridge.

Rules Claude follows on the Pi: never types passwords, licence keys or tokens (you paste them where
asked); never opens anything to the internet before Part C; the campaign world is never used for
tests.

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

| What                                   | Where                                                               |
| -------------------------------------- | ------------------------------------------------------------------- |
| Foundry program                        | `/opt/foundry`                                                      |
| Foundry data (worlds, modules, assets) | `/var/lib/foundry`                                                  |
| Node.js                                | `/opt/node24`                                                       |
| The tool (release builds)              | `/opt/foundry-ai-tool`                                              |
| Settings and secrets for the tool      | `/etc/foundry-ai-tool/.env` (readable by root and the service only) |
| The tool's storage (bridge vault)      | `/var/lib/foundry-ai-tool`                                          |
| Backups                                | the USB drive, mounted at `/mnt/backup`                             |

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
