# Discord bot (recorder)

Records a Discord voice channel with one track per speaker, for the session notes pipeline
(`tools/transcriber`, `tools/session-pipeline`). Later versions add the notices from D-069
(session-day reminder, `/away`, bridge up or down, GM alerts).

Status: the recorder passed the rehearsal rig and a 2-hour soak (2026-10-03); a test with real
people is still to come. Works through Discord's end-to-end voice encryption (DAVE) with
`@discordjs/voice` 0.19.2 and `@snazzah/davey`. It runs on Windows and on the Orange Pi (below).

## Setup

1. Create a bot application in the Discord Developer Portal. Put its token in
   `%APPDATA%\foundry-ai-tool\discord-bot.env`, never in the repo or a chat:

   ```ini
   DISCORD_TOKEN=...
   DISCORD_GUILD_ID=<your server id, so /record shows up at once>
   # FVTT_SESSIONS_DIR=C:/Users/<you>/Documents/FoundrySessions (the default)
   # DISCORD_OWNER_ID=<your Discord user id> (optional: who gets the storage space DMs)
   ```

2. Invite the bot with the scopes `bot` and `applications.commands` and the permissions View
   Channels, Connect, Send Messages and Use Slash Commands.
3. Build and run (Node 22.12 or newer):

   ```bash
   npm run build -w @gnuminator/discord-bot
   npm start -w @gnuminator/discord-bot
   ```

## Use

- `/record start` in any text channel while you sit in the voice channel: the bot joins
  (self-muted) and posts a recording notice.
- `/record stop`: the bot leaves, converts the recording and replies with a summary.
- `/record status`: what is being recorded.

By default only members with Manage Server see `/record`; change that under Server Settings >
Integrations. Ctrl+C in the bot window also stops and converts a running recording.

## Storage space notices

Every 15 minutes the bot reads the Pi's space check (`/var/lib/foundry-ai-tool/space/status.json`,
written by the hourly space check in `scripts/pi/`; override the path with
`FOUNDRY_AI_SPACE_STATUS`) and sends the owner a Discord DM:

- one DM when space gets worse (under 20% free is low, under 5% or less than a job needs is
  critical, or the check itself has not run for 3 hours);
- while it stays bad, at most one reminder every 24 hours;
- one "back to normal" DM when it recovers. There is a margin so a disk hovering around the line
  does not send a DM on every crossing: after a low notice, "back to normal" comes only when every
  disk is at least 2 points above the threshold (22% for the default 20%), and critical is left only
  above the critical line plus 1 point. In between the bot stays in the old state and sends nothing
  new (the 24 hour reminder still applies).

The DM names the disk, the free percent and GB, and the backup, snapshot and sync jobs that use
that disk. A missing, unreadable or invalid status file says nothing (the bot logs it once), so a
PC without the Pi's file gets no notices and no errors.

**Who gets the DM.** `DISCORD_OWNER_ID` in `discord-bot.env` (your Discord user id) when set;
otherwise the owner of the bot application in the Developer Portal (the account that made the bot;
for a team, the team's owner user, never the team's own id), which the bot asks Discord for at start. So nothing needs setting
when you made the bot yourself. If neither gives an id, the bot logs "storage space DMs are off"
once. The owner must share a server with the bot. If a DM fails, the bot logs it (at most once per
24 hours) and tries again at the next check. The state is kept in memory: a restart can repeat one DM.

The reader (`src/space-status.ts`) is an identical copy of `shared/src/space-status.ts`, because
the bot is deployed alone on the Pi; a test fails while the two differ, so edit the shared one and
copy it over.

## Stale backup copy notices

On the Pi the bot also watches that this PC keeps copying the Pi's backups. After each successful
run, the PC's `pull-restic.ps1` and `pull-snapshot.ps1` run a fixed command on the Pi
(`/opt/foundry-ai-tool/backup/record-pull.sh restic|snapshot`, installed by Pi stage 6), which
writes the Pi's own clock into `/var/lib/foundry-ai-tool/backup-pulls/<kind>.json`
(`{"version":1,"kind":"restic","pulledAt":"2026-10-06T10:31:02Z"}`). Every 15 minutes the bot reads
both files (`src/backup-pull-status.ts`) and DMs the owner (same owner and failed-DM rules as the
space notices) when the newest copy of either kind is older than the limit
(`src/backup-pull-notify.ts`):

- one DM when the copies go stale, saying how long ago each kind was copied and what to do (turn
  the PC on, or run the two scheduled tasks);
- while they stay stale, at most one reminder every 24 hours;
- one "copied again" DM when a fresh copy arrives (only if a stale DM went out);
- nothing while no copy has ever been recorded, and nothing for a missing, unreadable or invalid
  file (logged once), so a fresh install or a dev PC never raises a false alarm.

Settings (`discord-bot.env`): `FOUNDRY_AI_BACKUP_STALE_DAYS` (days, default 3; anything that is not
a positive number falls back to 3) and `FOUNDRY_AI_BACKUP_PULLS` (the folder; leave it alone on the
Pi). Details and rollout: `docs/dev/PI-SETUP.md`, "Stale backup copies". The state is kept in memory:
a restart can repeat one DM.

## On the Orange Pi (D-068)

The bot runs on the Pi as a service (Pi setup Part B stage 8, `docs/dev/PI-SETUP.md`); the Pi has
no GPU, so transcription and the notes stay on the PC, which copies the finished recordings.

Checked on linux-arm64 with Node 24 on Debian 13 (2026-10-04, an arm64 container): `npm install`
needs no build tools (the only native part, `@snazzah/davey`, ships a `linux-arm64-gnu` binary;
no Opus or sodium library is needed: the bot stores the packets and writes the Ogg files itself,
and encryption uses Node's own AES-256-GCM); the tests pass; a recording converted there is
byte for byte the same as on the PC.

| What                   | Where                                                                        |
| ---------------------- | ---------------------------------------------------------------------------- |
| The bot                | `/opt/foundry-ai-tool/discord-bot` (`dist/`, `package.json`, `node_modules`) |
| Settings and the token | `/etc/foundry-ai-tool/discord-bot.env` (root:foundry, 0640)                  |
| The service            | `foundry-ai-tool-discord-bot.service` (runs as `foundry`)                    |
| Recordings             | `/var/lib/foundry-ai-tool/recordings` (foundry:foundry, 2770)                |

Install or update: Pi setup stage 8 (`scripts/pi/remote/8-recorder.sh`, run by Claude over
`ssh foundry-pi`). It copies the bot from the tool build stage 5 made (same version as the bridge),
pins its dependencies to the versions that build installed, runs `npm install --omit=dev`, makes the
recordings folder, writes `discord-bot.env` from `deploy/discord-bot.env.example` when it is
missing and installs `deploy/foundry-ai-tool-discord-bot.service`. The service stays off until the
token is in: the user runs `scripts/pi/set-discord-token.ps1` on the PC, which asks for the token
(and optionally the server id) without showing it, writes it on the Pi and starts the bot. Check:
`systemctl status foundry-ai-tool-discord-bot`, the journal's "Logged in as" line, and
`/record status` in Discord. After a new stage 5 build, run stage 8 again.

`systemctl stop` (or a restart for an update) stops a running recording cleanly and converts it.

**Getting the recordings to the PC.** `tools/session-notes/pull.ps1` (step 0 of `auto.ps1` when
`FVTT_PI_HOST` is set, normally `foundry-pi`) copies every finished session over SSH through
Tailscale, checks each file's SHA-256, puts it in the PC's sessions folder and marks it pulled on
the Pi; the Pi deletes pulled sessions after 7 days. A session counts as finished once
`raw/convert-report.json` exists (the converter writes it last). The pull logs in as the Pi's SSH
user from the setup (root; any member of the `foundry` group works too). The notes step then stages the notes on the bridge, which runs on the Pi
too: set `MCP_CONTROL_HOST` to the Pi's Tailscale name for `session-notes publish`.

## What lands on disk

`<sessions folder>/<date>_<time>-discord/`:

| File                                          | What                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `1-<username>.ogg`, `2-...`                   | one Opus track per speaker, all starting at session start (Craig naming, read by `voice-stack.ps1 transcribe`)      |
| `speakers.json`                               | track id to `{ "player": "<display name>" }` for the session pipeline; add `"character"` by hand; never overwritten |
| `raw/*.rec`                                   | the packets as received (see `src/rec/format.ts`)                                                                   |
| `raw/events.jsonl`                            | joins, leaves, speaking, connection changes, DAVE debug lines                                                       |
| `raw/session.json`, `raw/convert-report.json` | session summary and converter numbers                                                                               |

Convert again (after a crash, or with a newer converter):
`node packages/discord-bot/dist/cli.js convert <session folder>`.

## How it works

- One `Manual` subscription per user for the whole session (not `AfterSilence`, which loses the
  start of each sentence). A stream the library destroys is subscribed again.
- Nothing is decoded while recording. Each packet is stored with its arrival time on one session
  clock and its RTP sequence and timestamp (`src/rec/rtp-tap.ts` reads them from the UDP packet;
  this depends on library internals, which is why `@discordjs/voice` is pinned).
- The converter (`src/convert/`) puts packets back on the timeline: RTP timing inside a burst
  of speech, arrival time at the start of each burst, 20 ms Opus silence frames in the gaps. Frames
  that are still DAVE-encrypted (sent before the encryption session is ready) are dropped.
- A dropped connection is rejoined with backoff; the gap becomes silence and a logged event.

Tested offline with real Opus packets (tones placed at known times come out within 30 ms). The
live proof of concept (2 to 3 people, 30 minutes, a reconnect, compared with Craig) is next.

## Rehearsal (no people needed)

`rehearse` tests the recorder against known audio: up to three speaker bots play one recorded
track each into a voice channel while the recorder records them, in the same process.

```bash
node packages/discord-bot/dist/cli.js rehearse <folder of per-speaker tracks> [--seconds N] [--drop-at S | --no-drop] [--settle S]
```

- The folder holds one audio file per speaker (`S1__anna.wav` or `anna.wav`; anything ffmpeg
  reads). The busiest tracks are played, one per speaker bot, cut to the shortest.
- Like a Discord client, a speaker bot only sends while its speaker talks (a level gate with a
  short hangover), and its RTP timestamp keeps counting through the pauses.
- Halfway (or at `--drop-at`), the recorder's voice connection is dropped once, so the rejoin
  runs for real.
- Afterwards the recording is converted as usual and every recorded track is lined up with its
  source by cross-correlating 10 ms loudness envelopes in 20 s windows. The play start is known on
  the recorder's own clock, so the result is the real offset, not just a guess.

The run prints PASS or CHECK and writes `rehearsal.json` next to the recording, in
`FVTT_REHEARSAL_DIR` (default `Documents\FoundryRehearsals`, outside the sessions folder, so the
notes pipeline never picks a rehearsal up). PASS needs every track recorded, an alignment that
wanders under 40 ms (95th percentile), tracks within 40 ms of each other, under 1 % packet loss
outside the reconnect gap, and a rejoin after the drop. Needs ffmpeg on PATH.

Setup, once: create one bot application per speaker bot (Discord Developer Portal, New
Application; no privileged intents), invite each with the scope `bot` and the permissions View
Channels, Connect and Speak, and add to `discord-bot.env`:

```ini
REHEARSAL_TOKEN_1=...
REHEARSAL_TOKEN_2=...
REHEARSAL_TOKEN_3=...
REHEARSAL_CHANNEL_ID=<the voice channel; Developer Mode, right-click, Copy Channel ID>
```

Do not run the normal bot at the same time (the recorder logs in with `DISCORD_TOKEN` here too).
