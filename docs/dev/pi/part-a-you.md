---
title: Part A: you (the card and the first login)
description: What you need, what to install on this PC, and the five steps you do yourself: image, card, settings, first start.
---

# Part A: you (the card and the first login)

Part of [PI-SETUP](../PI-SETUP.md).

## What you need

- The Orange Pi 5 Pro and its official USB-C power supply (5 V, 5 A).
- A microSD card, 32 GB or larger (A2 class if you have one). An NVMe SSD later is strongly
  recommended before real play (done 2026-10-30, the card now only boots): see "Moving to NVMe" below.
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
