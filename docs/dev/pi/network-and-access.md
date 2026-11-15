---
title: Network and access
description: The UniFi gateway, players and the GM from outside, SSH keys only, the join page and the player connector.
---

# Network and access

Part of [PI-SETUP](../PI-SETUP.md).

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
   JWT at the tunnel" option: [Remote access, Part C](../REMOTE-ACCESS.md#part-c-players-and-the-gm-reach-the-orange-pi-through-cloudflare).
4. **Set the tunnel token yourself.** The Pi never logs in to Cloudflare. The tunnel page shows a
   token; you paste it into `set-tunnel-token.sh` in your own SSH session, which asks without showing
   it and stores it in a root-only file. Claude never sees it.

What Claude does: after a `dietpi-backup 1` snapshot and your OK, runs stage 12 once with
`FOUNDRY_PUBLIC_HOST=<Foundry's public name>`. That installs `cloudflared` on the Pi as a service
(from Cloudflare's apt repository, with its current signing key, started once the token is there) and
sets Foundry's proxy options for the public name. Which name goes to Foundry and which to the
dashboard (GM emails only) is set in the Cloudflare dashboard, not on the Pi. Then the phone test from
outside before anyone gets the address. Templates: `deploy/cloudflare/`; background:
[Remote access](../REMOTE-ACCESS.md).

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
  installs the picture as `worlds/curse-of-strahd/join-background.webp` (owner foundry, mode 644; a different picture
  already there is kept in `/var/lib/foundry-ai-tool/join-page-look/`; root never writes into the world folder, the
  foundry user copies the picture in), sets `background` and `description` in `world.json`, starts Foundry, waits
  for the join page, starts the Assistant GM browser and checks that `/join` names the picture and the picture is
  served. Until the join page answers, a failure stops Foundry, puts `world.json` back and starts both services again;
  a failing `/join` or picture check after that only reports (the edit stays). It refuses during a dnd5e system trial
  or a kit session, ignores a dropped SSH connection, and the same picture and description again change nothing.
- **Another description later** (Danni sends his own): change the HTML file and run it again.
- **Undo:** the same pipe with `UNDO=1` (and `EXPECT_SHA256`): the old description comes back, the background key is
  removed when it was not set before, and the picture goes (a kept earlier picture comes back) unless the restored
  background still names it.
- Check the result logged out (a private window), reload once. Tests: `scripts/pi/join-page-look.test.mjs`.

## Player connector (stage 30)

`scripts/pi/remote/30-player-connector.sh` (backlog `player-connector-pi`, D-136) is the Pi side of the player endpoint
`POST https://<player host>/mcp/player`. The Cloudflare side is made from the PC by
`scripts/pi/player-connector-cloudflare.mjs` (the tunnel is remotely managed, so its routes are not on the Pi): four
service tokens, an Access application with a service-auth policy only (no email policy, so a GM login is refused), the
tunnel route limited to the path `^/mcp/player$`, and the DNS name. That script sends the login table to the Pi as
`/root/player-connector.json.new`; the secrets never reach the screen, a log, the repo or the vault.

Stage 30 then installs the table as `/etc/foundry-ai-tool/player-connector.json` (foundry, 0600), writes
`/etc/foundry-ai-tool/player-connector.env` (`FOUNDRY_AI_PLAYER_CONNECTOR=on` and the table path) and a drop-in
`player-connector.conf` on the dashboard and bridge units, and adds the player host to `DASHBOARD_ALLOWED_HOSTS` in
`dashboard-access.env` (`set-dashboard-access.sh` writes that file whole, so run stage 30 again after it). Both services
run as `foundry`. It restarts them only if something they read changed (and asks first, before the first write, whether
players are online or a recording runs), and checks the 401 with no token, the 421 for an unlisted name, that ports
31414 to 31416 listen as before and that the bridge control port answers on loopback; a failed check ends the run with
exit 1 (the install stays; `CHECK=1` repeats the checks). It stops if `dashboard-access.env` has no
`DASHBOARD_ALLOWED_HOSTS` line. `FOUNDRY_AI_PLAYER_CONNECTOR_DEV_USER` must not be set on
the Pi; the stage refuses if it is. Modes: `DRY_RUN=1`, `CHECK=1`, `UNDO=1` (keeps the table). The ordered sitting steps are in
the vault note `Handoff/Pi sitting 2026-11-08 player connector.md`.
