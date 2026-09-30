# LiveKit recording proof of concept

Status: proof of concept, verified on the PC with a fake participant (see "What was verified").
The Foundry side (the LiveKit AVClient module in a real world) is still to be tested by hand.

## What it is

Foundry VTT cannot record voice or webcams by itself. This kit adds the missing pieces:

```
Foundry 14 + "LiveKit AVClient" module  --wss-->  livekit-server  <--> redis <--> egress
     (players talk, optional camera)                   |  webhook                  |
                                                       v                           v
                                               recorder (our service) -------> recordings/
                                               starts one TRACK egress per          <room>/<yyyy-mm-dd_HHMM>/
                                               published track                      <identity>__<source>__<trackSid>.ogg|webm
```

- `livekit-server` (SFU) relays the audio and video between the players.
- `egress` writes every published track straight to its own file (Ogg/Opus for audio, WebM or MP4
  for camera). No Chrome, no mixing: one file per person and per track.
- `recorder/` is our small Node service. LiveKit calls it on every event. On `track_published` it
  starts a track egress, on `room_finished` it writes `done.json`, and it keeps `session.jsonl`
  (server time, egress id, file name, joins and leaves) in the session folder for alignment.

Pinned versions (checked 2026-09-30, all have amd64 and arm64 images):

| Part | Version |
| ---- | ------- |
| `livekit/livekit-server` | `v1.13.7` |
| `livekit/egress` | `v1.14.1` |
| `redis` | `7-alpine` |
| `caddy` (optional local TLS) | `2.11.4-alpine` |
| `livekit-server-sdk` (recorder) | `2.19.1` |
| Recorder runtime | Node 22 (`node:22-alpine`) |
| Foundry module | LiveKit AVClient (`bekriebel/fvtt-module-avclient-livekit`), `0.6.6` to test |

## Local proof of concept (PC, Docker Desktop)

Needs Docker Desktop running and PowerShell 7. Nothing here touches Foundry or the bridge.

```powershell
pwsh tools/livekit/scripts/livekit-poc.ps1 init     # writes .env with random dev keys (gitignored)
pwsh tools/livekit/scripts/livekit-poc.ps1 up       # builds the recorder, starts the stack
pwsh tools/livekit/scripts/livekit-poc.ps1 status
pwsh tools/livekit/scripts/livekit-poc.ps1 test     # fake participant, 20 s tone, checks the .ogg
pwsh tools/livekit/scripts/livekit-poc.ps1 logs recorder
pwsh tools/livekit/scripts/livekit-poc.ps1 down
```

The script refuses to run if `.env` points a host port at 30000, 30001, 3100, 31414 to 31416 or
31514 to 31516. Ports used: 7880 (signalling, bound to 127.0.0.1), 7881 (TCP fallback), 7882/udp
(media), optional 7443 (TLS).

`test` joins the room `poc-room` from the `livekit/livekit-cli` container, publishes a generated tone
and prints the `ffprobe` result. Recordings land in `tools/livekit/recordings/` (gitignored).
`session.jsonl` in the session folder shows what the recorder did.

### Connect the Foundry module (LOCAL TEST world only)

Do this only in the local test Foundry (`C:\FoundryTest`, localhost:30001), not in a live campaign.

1. Setup screen, Add-on Modules, Install Module, manifest URL
   `https://github.com/bekriebel/fvtt-module-avclient-livekit/releases/download/v0.6.6/module.json`
   (the newest release is 0.6.8, but issue #105 reports a connection timeout with 0.6.8 and a fix by
   going back to 0.6.7, so start with 0.6.6).
2. Enable the module in the test world. In the world: Settings, Configure Settings, Audio/Video
   Communication: set "Audio/Video Conference Mode" to audio only or audio and video, and the A/V
   server type to LiveKit.
3. The module settings (Configure Audio/Video):
   - LiveKit Server: Custom
   - LiveKit Server Address: see the next point, **without** `wss://`
   - LiveKit API Key and Secret: the `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` values in `.env`
4. **The module always connects to `wss://<address>`**, so `ws://localhost:7880` will not work with
   it (the module source builds the URL as `wss://` plus the address). Use one of:
   - Local TLS (no account, nothing leaves the PC): `livekit-poc.ps1 up -Tls`, set the address to
     `localhost:7443`, and open `https://localhost:7443` once in the same browser and accept the
     certificate warning (Caddy's local certificate). Chrome then also allows the websocket.
   - A Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:7880`), address
     `<random>.trycloudflare.com`. This makes signalling reachable from the internet while it runs
     (a valid token is still required), so it is your decision; it was not run in this kit.
5. Media goes to 127.0.0.1:7882/udp on the same PC. Two browsers (two users, one of them a private
   window) on the PC are enough to test. Other machines on the LAN need `LIVEKIT_NODE_IP` set to the
   PC's LAN address and the `127.0.0.1` prefix removed from the signalling port mapping.
6. Join with two users, allow the microphone, talk. Expect one `.ogg` per user in
   `recordings/<room>/<yyyy-mm-dd_HHMM>/`. The room name is a random id the module stores in a world setting (GM breakout rooms get their own room and folder). Camera
   files appear only with `RECORD_VIDEO=true` in `.env` (then `up` again).

Participant identity in the file names is the Foundry user id. To get readable labels in
`session.jsonl` and `done.json`, copy `recorder-config/labels.example.json` to
`recorder-config/labels.json`, map user id or user name to a label, and set
`RECORDER_LABELS_FILE=/config/labels.json` in `.env`. Do not commit real player names (the
`labels.json` file is gitignored).

## Files

| File | Purpose |
| ---- | ------- |
| `docker-compose.yml` | project `fvtt-livekit`: livekit, redis, egress, recorder, optional `tls` profile |
| `livekit.yaml`, `egress.yaml` | local configuration, no secrets (keys come from `.env` through the compose file) |
| `livekit.pi.yaml`, `docker-compose.pi.yml` | template for the Pi and public setup, not used locally |
| `.env.example` | copy to `.env` or run `init` |
| `Caddyfile` | local TLS for the signalling port (optional) |
| `recorder/` | webhook service, standalone (own `package.json`, not an npm workspace): `npm ci`, `npm test` |
| `scripts/livekit-poc.ps1` | init, up, down, status, logs, test |

## Raspberry Pi 5 Pro (arm64) and public setup, outline

Not built or tested yet. `livekit.pi.yaml` documents the settings.

1. Prerequisites: a real public IPv4 (the router's WAN address equals what `ifconfig.me` shows, no
   CGNAT), a domain, a Pi with a fixed LAN address, a USB SSD for recordings (audio is under 1 GB per
   session, camera video about 13 GB per session at 720p).
2. Router: forward **UDP 7882** and **TCP 7881** to the Pi. Nothing else (not 7880, redis or 8080).
3. Cloudflare: a Tunnel with the public hostname `lk.<your domain>` pointing at
   `http://localhost:7880` (cloudflared on the Pi). Websockets work through it. Media does not pass
   the tunnel or Tailscale; only signalling does.
4. On the Pi: `docker compose -f docker-compose.yml -f docker-compose.pi.yml up -d`. Generate `.env`
   (run `livekit-poc.ps1 init` on the PC and copy the keys, or write the file by hand; never commit it).
   On Linux make `recordings/` writable for the egress user (`chmod 777`, the recorder also does this
   for the session folders it creates).
5. Foundry module address: `lk.<your domain>`, same key and secret.
6. Upload: about 5 to 10 Mbps for five people with video, much less for audio only.

## Known risks

- **Module and server versions.** The module's README recommends server v0.15.6, but its source
  uses `livekit-client` 2.17.3, which matches the 1.x server line. Only a live test will tell
  whether 0.6.6 joins a v1.13.7 server cleanly. If a join fails, check the browser console and
  `livekit-poc.ps1 logs livekit` first.
- **Issue #105 (0.6.8):** connection timeout on login; downgrading to 0.6.7 fixed it for the
  reporter. The reporter ran Foundry 13. Use 0.6.6 or 0.6.7.
- The module always uses `wss://`, see above. Foundry itself must also run on a secure page for
  microphone access (http://localhost counts as secure; a Pi needs https through the tunnel).
- Recorder restart in the middle of a session: tracks published before the restart are not
  recorded (the recorder only reacts to new `track_published` events). Reconnecting players publish
  new tracks and are picked up. A reconcile step on start (list rooms and start egress for live tracks)
  is a possible next step.
- A muted microphone may stop sending packets (DTX) or unpublish; the files then have gaps.
  Timing must always come from the egress start times, not from the file length.
- `egress` also writes small `EG_*.json` info files next to the recordings.
- Track egress is the light path (no Chrome, about 0.1 CPU per track on the PC test). It has not been
  run for a long session or on the Pi yet.
- The livekit-server container has no health check (the image has no shell). `status` checks
  port 7880 instead.

## How recordings feed `tools/session-pipeline`

Each session folder holds one file per person and track, plus:

- `session.jsonl`: one JSON object per line: `session_started`, `participant_joined/left`,
  `egress_started` (server time, egress id, file name, label), `track_unpublished`,
  `egress_ended` (size and, in `files[]`, `startedAtNs`, `endedAtNs`, `durationNs` from egress).
- `done.json` (when the room finishes): participants with labels, the list of tracks.

The pipeline's per-speaker input is a transcript per track with times relative to one session clock.
Transcribe each `.ogg` with faster-whisper (times start at 0 in every file), then add the offset
`files[].startedAtNs - <earliest startedAtNs or session_started time>` from `egress_ended` to every
word and segment time before `merge`. The track id for `merge` is the participant label (from
`done.json`), so `labels.json` should use the same names as the pipeline's `speakers.json`.
That alignment step is not written yet.

## Tests

```powershell
cd tools/livekit/recorder
npm ci
npm test      # vitest: naming, labels, event handling with a fake egress client
```
