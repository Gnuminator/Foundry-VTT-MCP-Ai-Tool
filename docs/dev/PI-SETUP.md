---
title: Orange Pi setup
description: Bring up the Orange Pi 5 Pro as the home server for Foundry, the tool, backups and the Discord bot, with as much automation as possible.
---

# Orange Pi setup

The Orange Pi 5 Pro (16 GB) becomes the always-on home server: Foundry VTT itself, the bridge, the
co-GM dashboard, the Discord bot, backups and vault sync. Decision: vault note D-068.

How the work is split:

- **Part A, you (about 30 minutes):** prepare a microSD card on this PC, plug the Pi in, run one
  script. After that this PC can reach the Pi over SSH.
- **Part B, Claude (over SSH from this PC):** everything else, in stages. Claude stops before each
  service install and at the few steps only you can do (licence key, logins in your browser).

Nothing here is needed before you have time for it. Day-to-day development and testing stay on this
PC's test server; the Pi only runs released builds and the campaign world.

## What you need

- The Orange Pi 5 Pro and its official USB-C power supply (5 V, 5 A).
- A microSD card, 32 GB or larger (A2 class if you have one). An NVMe SSD later is strongly
  recommended before real play: see "Moving to NVMe" below.
- An Ethernet cable to the router.
- A card reader on this PC.
- [balenaEtcher](https://etcher.balena.io) on this PC (to write the image to the card).
- For backups (can come later): a USB hard drive **with its own power supply** (or on a powered USB
  hub). A drive powered only by the Pi's USB port can drop out at spin-up.
- Fallback only: a monitor (HDMI) and a USB keyboard, if the Pi cannot be found on the network.

## Part A: you

### 1. Download and check the image

In PowerShell 7, from the repo folder:

```powershell
.\scripts\pi\prepare-sd.ps1 -Download
```

It downloads DietPi for the Orange Pi 5 Pro (Debian 13) into `Downloads\foundry-pi\` and checks its
SHA-256 checksum against the one DietPi publishes. Why DietPi: it has a dedicated image for this board
with point releases, and its card carries a small settings partition that Windows can write, so the
first boot is configured without a monitor.

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

- hostname `foundry-pi`, time zone `Europe/Copenhagen`, network by DHCP over Ethernet;
- the OpenSSH server with a new SSH key made for this PC (`~\.ssh\foundry_pi`), so Claude can log in
  without a password;
- a strong random root password, saved on this PC in `~\.foundry-pi\root-password.txt` (only needed at
  a monitor and keyboard);
- the Avahi service, so `foundry-pi.local` can be found on the network;
- nothing else: every other service is installed in Part B, one by one, after your OK.

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

| Stage           | What happens                                                                                                                                                                | Needs you                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Health check | Updates, disk, temperature, clock, time zone; a `foundry` system user and folders                                                                                           | no                                                                                                                                                                                                                          |
| 2. Node.js      | Node 24 (Foundry 14 requires it) from nodejs.org, checksum-checked                                                                                                          | no                                                                                                                                                                                                                          |
| 3. Foundry      | Installed as a service on port 30000                                                                                                                                        | **yes:** download the "Node.js" build from your foundryvtt.com account on this PC (the link lasts 5 minutes; Claude copies the file over), then enter the licence key and the admin password in your browser on first start |
| 4. Tailscale    | Private network for you, the GM and the players; Foundry served at `https://foundry-pi.<your-tailnet>.ts.net`                                                               | **yes:** open the login link Claude shows, and turn on MagicDNS and HTTPS certificates once in the Tailscale admin page                                                                                                     |
| 5. The tool     | Bridge and dashboard as services; a Chromium browser without a screen that stays logged into Foundry as a dedicated GM user, so the bridge works when no human GM is online | **yes:** create the GM user for the tool in Foundry and paste its password once when Claude asks                                                                                                                            |
| 6. Backups      | Nightly snapshots (restic) at 05:00 to the USB drive: Foundry data, the tool's storage, the Obsidian vaults. Keeps 14 daily, 8 weekly, 12 monthly; a monthly test restore   | plug in the drive                                                                                                                                                                                                           |
| 7. Vault sync   | Syncthing: the GM vault to the GM's PC, the player vault to anyone who wants the Obsidian app                                                                               | accept the device on each PC                                                                                                                                                                                                |
| 8. Discord bot  | Added when the bot is built                                                                                                                                                 | a bot token from the Discord developer page                                                                                                                                                                                 |

Rules Claude follows on the Pi: never types passwords or licence keys (you paste them where asked);
never opens anything to the internet; the campaign world is never used for tests.

## Players

Each player (and the GM) installs Tailscale on the device they play on and accepts your invite link.
The free plan covers 6 people, which fits the five of you. Then Foundry is at the same
`https://foundry-pi.<your-tailnet>.ts.net` address for everyone. Nothing is reachable from the
internet.

## Moving to NVMe (before real play)

microSD cards wear out and are slow under a server that writes all the time. With an M.2 NVMe SSD
(2280 size) in the Pi, Claude moves the system with DietPi's drive manager: the system runs from the
SSD and the card only starts it (the safe setup; booting straight from the SSD needs a bootloader in
the Pi's SPI flash, which is optional and only tried if the board exposes it).

## Where things live on the Pi

| What                                     | Where                                                               |
| ---------------------------------------- | ------------------------------------------------------------------- |
| Foundry program                          | `/opt/foundry`                                                      |
| Foundry data (worlds, modules, assets)   | `/var/lib/foundry`                                                  |
| Node.js                                  | `/opt/node24`                                                       |
| The tool (repo checkout, release builds) | `/opt/foundry-ai-tool`                                              |
| Settings and secrets for the tool        | `/etc/foundry-ai-tool/.env` (readable by root and the service only) |
| The tool's storage (bridge vault)        | `/var/lib/foundry-ai-tool`                                          |
| Backups                                  | the USB drive, mounted at `/mnt/backup`                             |

## Sources

Checked on 2026-09-29 (details in the vault research note for the Pi setup):
[DietPi hardware list](https://dietpi.com/docs/hardware/),
[DietPi `dietpi.txt`](https://github.com/MichaIng/DietPi/blob/master/dietpi.txt),
[Foundry requirements](https://foundryvtt.com/article/requirements/) (Node 24 for Foundry 14),
[Foundry installation](https://foundryvtt.com/article/installation/),
[Tailscale serve](https://tailscale.com/docs/reference/tailscale-cli/serve),
[Tailscale pricing](https://tailscale.com/pricing),
[Debian chromium package](https://packages.debian.org/trixie/chromium).
