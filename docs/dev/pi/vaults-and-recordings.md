---
title: Vaults, Syncthing and recordings
description: The GM vault, who it is shared with, the player vault, vault sync checks, recordings, the recorder endpoint and the Discord bot.
---

# Vaults, Syncthing and recordings

Part of [PI-SETUP](../PI-SETUP.md).

## The GM vault and Syncthing

The bridge writes the GM's Obsidian vault on the Pi, in `/var/lib/foundry-ai-tool/obsidian/gm`: the
session log, the change log, the play stats and the Library notes. `7-vault.sh` (stage 7) sets that
up and runs Syncthing as its own service, `foundry-ai-tool-syncthing` (user `foundry`, its files in
`/var/lib/foundry-ai-tool/syncthing`, never in Foundry's data folder). Stage 7 also takes
`DASHBOARD_FOUNDRY_URL=https://play.<domain>` for the initiative ribbon's portraits (see
[REMOTE-ACCESS.md](../REMOTE-ACCESS.md), Part C step 4). Syncthing keeps the folder
`foundry-gm-vault` the same on every PC you add, in both directions: the GM's own notes in `Prep/` go
back to the Pi and into its nightly backups. The player vault has its own shares, one folder per player
who asks (stage 21, "Player vault share" below).

How it is set up: UPnP and NAT-PMP are off (Syncthing never asks the router to open a port, the same
rule as Foundry's `--noupnp`), usage and crash reports are off, and the web page of Syncthing listens
on the Pi itself only. Global discovery and relays are on, so a PC outside the home still finds the
Pi; relays only pass on traffic that is encrypted end to end. A PC can connect only after the Pi
has added its device ID. Each PC keeps its own `.obsidian/workspace*.json`, `.obsidian/cache` and
`.trash` out of the sync (`.stignore`, which Syncthing does not sync, so every PC has its own copy;
both scripts write it). The Pi runs Syncthing 1.x (Debian 13) and a PC installed with winget runs
2.x; they speak the same protocol and should sync with each other (the container test used 1.x on both
sides; the first sync with a real PC is the check).

**Add a PC** (the GM's PC; since D-139 this PC no longer gets the GM vault, so the user cannot read the GM's campaign text):

1. On that PC: `winget install Syncthing.Syncthing`, then in PowerShell 7
   `.\scripts\pi\setup-syncthing-pc.ps1 -PiDeviceId <the Pi's device ID>` (Claude prints the ID
   after stage 7). It registers a hidden task "Syncthing" that starts at logon, sets the options
   above, adds the Pi and the folder at `Documents\Obsidian\Foundry GM vault` (change it with
   `-VaultPath`), and prints this PC's device ID. `-Remove` takes the task away again and leaves the
   settings and the vault alone.
2. Give that device ID to Claude. Claude runs stage 31 (`ADD=1 DEVICE_ID=<id> DEVICE_NAME=<a name>`, see "Who the GM vault is
   shared with (stage 31)"): the Pi adds the PC and shares the folder, and it starts to sync (no
   duplicates if it runs twice). Stage 7 with `PEER_ID` still does the same for a first PC, but it rewrites the bridge and
   dashboard settings; `VAULT_NAME` there is the vault's folder name on the PC (default
   `Foundry GM vault`), which the dashboard's "Open in Obsidian" links use.
3. Open the folder as a vault in Obsidian.

The Foundry mirror is a separate, per-world switch (D-083): the Foundry setting "AI Tool: Obsidian
mirror (writes)" plus the guarded `plan-obsidian-mirror` tool, which the GM asks Claude for
(Admin set). It stays off until the GM decides to use it for a world. The session, change and stats
notes are written to the vault whenever the folder is set, mirror or not.

## Recordings

The Pi records the Discord voice channel but does not transcribe: it has no graphics card, and speech
to text runs on this PC (faster-whisper). After `/record stop` the bot converts the recording on the
Pi. This PC's session pipeline (`tools/session-notes/auto.ps1`, with `FVTT_PI_HOST=foundry-pi`) then
copies every finished recording over SSH through Tailscale, checks each file, and marks it copied on
the Pi; the Pi deletes copied recordings after 7 days. The recorded audio on this PC is kept (D-097):
nothing deletes it automatically, only a player's request does. Details:
[the bot's README](../../../packages/discord-bot/README.md#on-the-orange-pi-d-068).

## Recorder status endpoint (stage 27)

Stage 27 (`scripts/pi/remote/27-bot-status.sh`) switches on the health line's Recorder dot on the Pi: it sets
`FOUNDRY_AI_BOT_STATUS_PORT=3110` in `/etc/foundry-ai-tool/discord-bot.env` (one line; the rest of the file, with
the Discord token, is never printed) and writes a systemd drop-in for the dashboard,
`foundry-ai-tool-dashboard.service.d/bot-status.conf`, with `DASHBOARD_BOT_STATUS_URL=http://127.0.0.1:3110/status`
(a drop-in because stage 7 rewrites `dashboard.env` whole and stage 5 rewrites the unit). It refuses unless the
deployed bot and dashboard builds know the settings (stage 5, then 8, with a release that has them), restarts the
bot and then the dashboard only when something changed (`require_quiet`: not while players are online or a
recording runs, so never on a game night), and checks that `GET /status` answers JSON.

- **Look first:** `cat scripts/pi/remote/lib.sh scripts/pi/remote/27-bot-status.sh | ssh foundry-pi 'DRY_RUN=1 bash -s'`
  (the dry run also refuses a port that is already in use, so the plan does not look fine on a busy port)
- **Run:** after a `dietpi-backup` snapshot and the user's OK, the same pipe with `bash -s`. Then look at the GM
  health line with a recording running: the Recorder dot shows only when something is wrong, grey "unknown" means
  the dashboard cannot reach the bot.
- **Undo:** the same pipe with `UNDO=1`. `PORT=<n>` picks another port. An UNDO that was cut off is finished by
  running it again: the rerun restarts a dashboard whose process still carries `DASHBOARD_BOT_STATUS_URL`.
- Tests: `scripts/pi/bot-status-stage.test.mjs`.

## Discord bot on the game server (stage 26)

The Pi's bot (`/etc/foundry-ai-tool/discord-bot.env`) was set up against a test server. Stage 26
(`scripts/pi/remote/26-discord-game-server.sh`) points it at the game server "D&D GUTTERNE": `DISCORD_GUILD_ID`
(so `/record` registers there at once), `DISCORD_SESSION_POST_CHANNEL_ID` (#session-notes, the session-over post),
`GAMENIGHT_WATCH_CHANNEL_ID` (#gm-bot; the recorder's alerts go there too, or to `DISCORD_GM_BOT_CHANNEL_ID` when that is set) and `DISCORD_CHANGELOG_CHANNEL_ID` (#changelog, Pi deploy lines). The token
and every other line stay as they are and are never printed. The first real run saves the old file as
`discord-bot.env.before-game-server` (same owner and mode, it holds the token) and restarts the bot, which ends a
recording, so it refuses while players are online or a recording runs. `/record` registered in the old server stays
there until the bot leaves it.

- **Look first (changes nothing):** `cat scripts/pi/remote/lib.sh scripts/pi/remote/26-discord-game-server.sh | ssh foundry-pi 'DRY_RUN=1 bash -s'`
- **Run:** after a `dietpi-backup` snapshot and the user's OK, the same pipe with `'bash -s'`. The session-over post
  also needs the player page link, which the Pi's file does not have: add `PLAYER_PAGE_URL=https://<player page>` (no
  `?token=`; it also sets `FOUNDRY_AI_DASHBOARD_URL=http://127.0.0.1:3000`, the Pi's dashboard port). Without it the
  stage warns that the post stays off. A rerun after a cut-off run restarts a bot that is older than the file.
- **Check:** `CHECK=1` (the four lines, and "Registered /record in server ..." in the bot's journal since it started), then
  `/record` in a voice channel on the game server and a session-over post in #session-notes.
- **Undo:** the same pipe with `UNDO=1` (the six keys the stage manages, the four ids and the two addresses, go back to their saved values, a key the saved file lacks is removed, the token and every other line stay as they are now; the bot is restarted).
- Tests: `scripts/pi/discord-game-server.test.mjs` and `scripts/pi/container-test/stage26-scenarios.sh`.

## Vault sync check and time zone (stage 20)

Stage 7 puts the GM vault in `/var/lib/foundry-ai-tool/obsidian/gm` (on the Pi's root disk, which is the data
volume: the NVMe move clones it, so the path does not change) and shares it with each added PC through Syncthing.
Stage 20 (`scripts/pi/remote/20-vault-sync.sh`, Obsidian O8) is the check that it works and stays tidy:

- **The folder:** where `foundry-gm-vault` points, which disk it is on, and a warning if that is not the tool's data folder.
- **The PCs:** which shared devices are connected right now (a PC that is off is only a note: it syncs when it comes back).
- **Conflicts:** every `.sync-conflict-*` file, listed with its date. Syncthing makes one when the same note was changed on
  two PCs before they met; both versions are kept. The GM opens both in Obsidian, keeps what is wanted and deletes the extra
  file. The stage never moves, merges or deletes a vault file.
- **The time zone:** must be `Europe/Copenhagen` (`TIMEZONE=<zone>` for another), because the session log, the change log and
  the play stats stamp their notes with the Pi's local time. Today's Pi is already on it.

Without `SET_TIMEZONE=1` the stage only reads: no snapshot, any time, game night included.

- **Report:** `cat scripts/pi/remote/lib.sh scripts/pi/remote/20-vault-sync.sh | ssh foundry-pi 'bash -s'` (warnings are
  not failures; it fails when Syncthing, its service, the foundry user or the folder is missing, or `TIMEZONE` is not a zone name).
  `STRICT=1` also fails on a conflict, a wrong zone or a folder shared with no PC. The disk warnings never fail it.
- **Set the zone** (only if the report says it is wrong): after a `dietpi-backup` snapshot and the user's OK, the same pipe with
  `SET_TIMEZONE=1`. It runs `timedatectl set-timezone`; the bridge and the dashboard read the zone at start, so restart them
  (or the Pi) before the next session.
- **O8 run order on the Pi day:** snapshot (`/boot/dietpi/dietpi-backup 1`), stage 7 (already run; run it again only with
  `PEER_ID=<the PC's ID>` and `PEER_NAME` to add a PC), then this stage's report, and a test note written on each side.
- Tests: `scripts/pi/vault-sync.test.mjs` (the stage as text, and with `PI_STAGE20_CONTAINER=1` two real Syncthings in a
  Debian 13 ARM64 container: a note each way, a forced conflict, the zone checks).

## Who the GM vault is shared with (stage 31)

`scripts/pi/remote/31-gm-vault-peers.sh` (backlog `r1-gm-vault`, D-139) adds a PC to the GM vault and takes one off, touching
only Syncthing's device list on the folder `foundry-gm-vault` (stage 7 does the first PC with `PEER_ID`, but it rewrites the
bridge and dashboard settings and cannot remove a PC). It never writes, moves or deletes a vault file.

- **Report** (no settings, read-only, any time): the devices on the vault, which are connected and how much of the vault each
  holds. `cat scripts/pi/remote/lib.sh scripts/pi/remote/31-gm-vault-peers.sh | ssh foundry-pi 'bash -s'`
- **Add:** `ADD=1 DEVICE_ID=<id> DEVICE_NAME=danni-pc`. The device is no introducer and does not auto-accept folders. Refused for
  a device that is on a player folder (D-067). The PC then sees a yellow bar for the Pi and for the folder
  ([the GM's guide](../../gm/setup-obsidian-sync.md)).
- **Remove:** `REMOVE=1 DEVICE_ID=<id>`. Refused unless another connected device on the vault holds all of it (100 %, nothing left to
  fetch, its index known), the device to remove is connected and the Pi has pulled everything it announced; so the Pi is never the
  only copy and nothing is lost with the removed PC. `FORCE=1` skips these checks. The device is forgotten when it is on no other folder. The PC keeps its own copy of
  the folder: whoever owns it deletes that by hand.
- Add and remove need a `dietpi-backup` snapshot from today and the user's OK. Nothing restarts. Test:
  `scripts/pi/gm-vault-peers.test.mjs` (text, and with `PI_STAGE31_CONTAINER=1` three real Syncthings in a container).

**Giving the GM his own vault (D-139), in this order:**

1. The GM installs Obsidian and Syncthing from the guide and sends his device ID to the user.
2. Snapshot, then `ADD=1` with his ID. He accepts the Pi and the folder; the report shows him at 100 %.
3. Only then take this PC off: check this PC's own Syncthing shows the folder and foundry-pi as Up to Date, then `REMOVE=1` with
   this PC's device ID (the report names it). The nightly restic backup of the Pi is
   the restore; there is no file versioning on the folder (the user's choice, D-139).
4. Delete the vault copy on this PC by hand, so no plain copy of the campaign text stays on the user's disk (the Pi's encrypted
   restic backup that this PC pulls to `E:\PiBackup` still holds it; the user would need its password to read it). **Order matters, there is no file
   versioning:** a delete that reaches the Pi while the share is still on removes the notes on the Pi and then on the GM's PC.
   So first run the stage 31 report and check it no longer lists this PC; then take the folder `foundry-gm-vault` out of this
   PC's Syncthing (or stop Syncthing; `setup-syncthing-pc.ps1 -Remove` only removes the logon task); only then delete the files.
5. Rotate the plugin credentials (below), so the test vault's token stops working.

**Rotating the plugin credentials** (`partc-leftovers`): the plugin uses two things, the Cloudflare service token
`obsidian-gm-plugin` (Client ID and Secret, [REMOTE-ACCESS.md](../REMOTE-ACCESS.md) Part C step 11) and the dashboard's GM token.

- **Cloudflare token:** in Cloudflare One, Service credentials, rotate `obsidian-gm-plugin` (the user does this in the dashboard)
  and give the new Client ID and Secret to the GM privately. This alone ends the test vault's access to the dashboard name.
- **GM token** (not planned: the user chose on 2026-11-11 to rotate only the Cloudflare token; `set-dashboard-access.sh --rotate-token`): a Pi change that rewrites `dashboard-access.env` whole and restarts the
  dashboard. It needs a snapshot from today, the user's OK and a quiet table (nobody online, no recording), and **stage 30 must
  run again afterwards** (it puts the player connector's allowed hosts back). Whether the user keeps GM access through the old
  link is the user's call: the new token ends the link for every browser that used the old one. Give the GM the new token
  privately.

Both values go into the plugin's settings as in [the plugin guide](../../gm/setup-obsidian-plugin.md).

## Player vault share (stage 21)

The co-GM dashboard writes one Obsidian vault per player (O7) into
`/var/lib/foundry-ai-tool/obsidian/players/<Player name>/` once `FOUNDRY_AI_PLAYER_VAULTS_DIR` is set. Stage 21
(`scripts/pi/remote/21-player-vault.sh`, backlog `player-vault-sync`, D-134) sets it and shares each player's folder with that
player's own devices through the Syncthing of stage 7. Design: vault `Design/Player vault sync 2026-11-02.md`; the player's side
is `docs/player/obsidian.md`.

- **Opt-in, one way:** a Syncthing folder `foundry-player-<slug>` per player, **Send Only** on the Pi, shared only with that
  player's devices (no introducer, no auto-accept). A player's change or deletion is ignored on the Pi. A player who never sends a
  device ID is never touched. One device belongs to one player and never to `foundry-gm-vault`; the stage refuses otherwise.
- **The dashboard switch** is a systemd drop-in, `foundry-ai-tool-dashboard.service.d/player-vault.conf`, not a line in
  `dashboard.env` (stage 7 rewrites that file whole). The dashboard restarts only when the drop-in is new or changed (and is started if it was
  stopped), through the usual quiet check (no players online, no recording). `OFF=1` asks for quiet first, restarts a running
  dashboard once, and leaves a stopped one stopped; the report compares the running process with the drop-in.
- **Only a folder the dashboard wrote is shared** (it must hold `.aitool-player.json`, and must not be a link). The stage never
  writes, moves or deletes a vault note; its only file in a player folder is Syncthing's `.stignore` (temp files and the marker).
- **Report** (read-only, any time): `cat scripts/pi/remote/lib.sh scripts/pi/remote/21-player-vault.sh | ssh foundry-pi 'bash -s'`.
  `STRICT=1` fails on a folder that is not Send Only, a device on two players or on the GM vault, a missing folder.
- **Pi sitting, after the O8 run of stage 20** (snapshot `/boot/dietpi/dietpi-backup 1` and the user's OK first):
  1. `SETUP=1` switches the dashboard's player vaults on and restarts the dashboard once; wait a minute and run the report to see
     the folder names.
  2. Per player who asked (they send a device ID, see the player guide): `PLAYER="<folder name>" DEVICE_ID=<id> DEVICE_NAME=<name>`.
     It prints the Pi's device ID; the player compares it, accepts the Pi and the folder and sets it to Receive Only. The
     remote shell reads the ssh line first: a folder name with an apostrophe (D'Arcy) needs it written as `'\''`, and
     `DEVICE_NAME` is something the operator picks, never pasted from a player's message.
  3. Stop: `REMOVE=1 PLAYER="<name>" [DEVICE_ID=<id>]` (a device, or the whole player folder out of Syncthing, files stay);
     `OFF=1` takes every player folder out of Syncthing and removes the drop-in.
- Tests: `scripts/pi/player-vault.test.mjs` (the stage as text, and with `PI_STAGE21_CONTAINER=1` three real Syncthings in a
  Debian 13 ARM64 container: a note reaches only its player, what a player changes never reaches the Pi, one device per player,
  remove and off).
