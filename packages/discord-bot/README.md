# Discord bot (recorder proof of concept)

Records a Discord voice channel with one track per speaker, for the session notes pipeline
(`tools/transcriber`, `tools/session-pipeline`). Later versions add the notices from D-069
(session-day reminder, `/away`, bridge up or down, GM alerts).

Status: proof of concept, not tested live yet. Works through Discord's end-to-end voice
encryption (DAVE) with `@discordjs/voice` 0.19.2 and `@snazzah/davey`.

## Setup

1. Create a bot application in the Discord Developer Portal. Put its token in
   `%APPDATA%\foundry-ai-tool\discord-bot.env`, never in the repo or a chat:

   ```
   DISCORD_TOKEN=...
   DISCORD_GUILD_ID=<your server id, so /record shows up at once>
   # FVTT_SESSIONS_DIR=C:/Users/<you>/Documents/FoundrySessions (the default)
   ```

2. Invite the bot with the scopes `bot` and `applications.commands` and the permissions View
   Channels, Connect, Send Messages and Use Slash Commands.
3. Build and run (Node 22.12 or newer):

   ```
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

```
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

```
REHEARSAL_TOKEN_1=...
REHEARSAL_TOKEN_2=...
REHEARSAL_TOKEN_3=...
REHEARSAL_CHANNEL_ID=<the voice channel; Developer Mode, right-click, Copy Channel ID>
```

Do not run the normal bot at the same time (the recorder logs in with `DISCORD_TOKEN` here too).
