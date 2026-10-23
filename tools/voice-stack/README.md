# Voice stack (Docker)

The voice work as one Docker Compose project, so Docker Desktop shows it as **one group** and you can
start, stop and read logs in its GUI.

```text
fvtt-voice  (Docker Desktop > Containers)
 |- profile livekit     livekit, redis, egress, recorder   (from tools/livekit; "tls" adds local Caddy)
 |- profile transcribe  transcriber (GPU job), pipeline (CPU job)
 '- profile media       reserved for ComfyUI later (a commented placeholder in docker-compose.yml)
```

Nothing starts without a profile. The transcriber and the pipeline are **jobs**: they run, write their
files and exit (they show as stopped containers in the GUI, which is normal). The LiveKit services are
long-running.

## Setup

Needs Docker Desktop with GPU support (the transcriber was tested on an RTX 5080, driver 616.92) and
PowerShell 7.

```powershell
pwsh scripts/voice-stack.ps1 init              # writes tools/voice-stack/.env (gitignored), random LiveKit dev keys
pwsh scripts/voice-stack.ps1 up transcribe     # builds the two job images (the first build takes a few minutes)
```

The script creates `.env` by itself when it is missing, because Compose needs the LiveKit variables
to exist even when you only transcribe. Edit `FVTT_SESSIONS_DIR` in `.env` if you want another folder.

## Commands

| Command                                | What it does                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `voice-stack.ps1 up livekit`           | builds the recorder and starts livekit, redis, egress, recorder                                           |
| `voice-stack.ps1 up tls`               | the same plus local TLS for the Foundry module (`wss://localhost:7443`)                                   |
| `voice-stack.ps1 up transcribe`        | builds the `fvtt-transcriber` and `fvtt-session-pipeline` images                                          |
| `voice-stack.ps1 names <session>`      | builds `<session>/names.txt` (the names Whisper listens for) from the Foundry world and `extra-names.txt` |
| `voice-stack.ps1 transcribe <session>` | runs the transcriber, then the pipeline, and prints where the outputs are                                 |
| `voice-stack.ps1 status`               | containers, GPU memory, images, sessions folder                                                           |
| `voice-stack.ps1 logs [service]`       | follow the logs                                                                                           |
| `voice-stack.ps1 down`                 | stops and removes the project's containers; keeps the model cache volume                                  |

`transcribe` options: `-Model <name|path>` (default `large-v3`), `-Force` (redo finished tracks),
`-NoPipeline`, `-NoAutoFix`, `-Hotwords` (pass `<session>/names.txt`, or `vocab.txt` when there is no
names file, to Whisper as hotwords; off by default, see the results below; `-NoHotwords` is kept and
does nothing). `<session>/names.txt` goes to the pipeline as the known names for automatic name
fixes (every fix is listed in `timeline/fixes.json`; `-NoAutoFix` turns them into suggestions).

`names` options: `-Dashboard <url>` (default `http://127.0.0.1:3100`, the co-GM dashboard of the
Foundry world), `-Offline`, `-Items`, `-Journals`. Without the dashboard it uses only
`<session>/extra-names.txt` (or `extra-names.txt` in the sessions folder): one name per line, for names
the world does not have.

The script refuses to run when `.env` sets any `*_PORT` to a Foundry or bridge port (30000, 30001, 3100,
31414 to 31416, 31514 to 31516). It only ever touches the `fvtt-voice` project; other containers on the
machine are left alone. Do not run it together with `tools/livekit/scripts/livekit-poc.ps1 up`: both
use ports 7880 to 7882.

## Where files go

All on the host, outside the repo, in `FVTT_SESSIONS_DIR` (default
`%USERPROFILE%\Documents\FoundrySessions`). One subfolder per session:

```text
FoundrySessions/
  livekit-recordings/<room>/<yyyy-mm-dd_HHMM>/   written by the livekit profile (one .ogg per person)
  2026-11-07/                                    a session folder: per-speaker audio, or a Craig .zip
    speakers.json  vocab.txt  rules.json         optional, read by the pipeline (see tools/session-pipeline)
    names.txt  extra-names.txt                   names for hotwords and name fixes (`names` command builds names.txt)
    transcripts/json/<speaker>.json              transcriber output (one per speaker)
    transcripts/run.json                         settings and timings of the run
    timeline/timeline.md (+ .jsonl, fixes, ...)  pipeline output
```

`transcribe <session>` takes a folder name under the sessions folder or a full path (a Craig `.zip`
works too). Audio is searched recursively; `transcripts`, `timeline` and `out` are skipped. Copy a
LiveKit session folder out of `livekit-recordings` (or point at it) to transcribe it. Never commit any
of this: the repository is public.

The Hugging Face model cache lives in the named volume `fvtt-voice-hf-cache` (the first run downloads
`large-v3`, about 3 GB, and loads it in under a minute afterwards).

## Hugging Face token

Only needed for gated models (saga-2-m). Set `HF_TOKEN_FILE=C:/Users/you/.cache/huggingface/token` in
`.env`. The file is bind-mounted read-only at `/run/secrets/hf_token` and `HF_TOKEN_PATH` points there,
so the token is never copied into an image or printed. Without the setting an empty placeholder file
(`secrets/no-token`) is mounted, which is fine for public models.

## Other models (hviske-v6, saga-2-m)

Set `TRANSCRIBER_EXTRAS=1` and `TRANSCRIBER_TAG=extras` in `.env`, run `up transcribe` (adds torch
2.11.0 for CUDA 12.8 and transformers, several GB), and pass a model folder or Hugging Face id with
`-Model`. A model folder on the host must be mounted into the container; for now run the job by hand:

```powershell
docker compose -f tools/voice-stack/docker-compose.yml --project-directory tools/voice-stack `
  --profile transcribe run --rm -v "<session>:/session" -v "<models>/hviske-v6:/models/hviske-v6:ro" `
  transcriber /session --out /session/transcripts --model /models/hviske-v6
```

## Which model, and why (2026-10-24)

Default: `large-v3`, language `da`, no hotwords. Speed does not matter here (the rule is best quality
within about real time): `large-v3` runs at 0.06 of real time on the GPU PC, so a 3 hour session
takes about 11 minutes; turbo is about 3 times faster and not needed.

Bench (VAD threshold 0.4 and 500 ms silence; the transcriber itself uses the faster-whisper VAD
defaults) on six 60 s slices of the David GM test recording (2026-10-23, two speakers, Danish with English
game words; the audio stays private). There is no hand-made reference, so each slice is judged by
agreement: distance of each candidate from the consensus (the candidate closest to all the others),
plus reading the disputed spans. Lower is closer to the consensus.

| Candidate (beam 5, VAD on)          | distance to consensus | RTF  | What the disputed spans show                                                 |
| ----------------------------------- | --------------------- | ---- | ---------------------------------------------------------------------------- |
| large-v3 `da`                       | 4.9 %                 | 0.06 | best Danish spelling and word endings; drops short English asides on 1 slice |
| large-v3 auto                       | 4.9 %                 | 0.06 | identical to `da` here (language detected as Danish on every slice)          |
| large-v3 auto, per-segment language | 7.0 %                 | 0.06 | keeps the English tail on the English-only slice; otherwise identical        |
| large-v3, VAD chunks, `da`          | 8.5 %                 | 0.06 | hallucinated lead-in phrases, mangled the mixed slice ("put the COM in")     |
| large-v3, VAD chunks, auto          | 8.9 %                 | 0.07 | same as above                                                                |
| turbo `da` / auto                   | 12.3 %                | 0.02 | misspells Danish ("stedspadsløs"), garbles the start of an English sentence  |
| turbo, VAD chunks, auto             | 19.6 %                | 0.03 | worst                                                                        |
| large-v3 forced `en`                | n/a                   | 0.11 | translates the Danish into English: never use for mixed audio                |

Whole recording, both tracks (95 min each), large-v3: `da` 359 s and 136 s, per-segment language 315 s
and 145 s, 8502 and 3924 words, within one word of each other. So per-segment language detection
changes nothing on long audio and is not turned on.

Short hotword list (co-GM, Strahd, Danni, Foundry, dnd5e, Silvera, Rokksteddy, David, Barovia) against
none, same slices: on turbo it made the transcript worse (dropped 13 of 87 words on the game-terms
slice); on large-v3 it fixed some spans (a missed sentence, "som GM", "halfling") and broke others
("trykker" for "så klikker du", "på bar" for "barbare", an English aside dropped). Not a clear win, so
hotwords stay off by default, as the older long-form benchmark found. The tool's own names are fixed
after transcription instead (session pipeline, `data/product_rules.json`).

Known limit: when a recording starts with a whole English sentence and then Danish, large-v3 with `da`
can leave the English sentence out (the 2026-10-23 recorder test). Forcing `en` keeps both sentences
but translates Danish elsewhere, and per-segment language detection did not fix it. Where this
matters, a turbo run (`-Model large-v3-turbo`) keeps the English and can be compared by hand.

## GPU sharing

One GPU job at a time. `large-v3` needs about 4 GB of VRAM, but two jobs at once slow each other
down, and the bigger models can run out of memory. `transcribe` prints the GPU memory before it starts
and warns when more than 6 GB is already in use. The LiveKit services do not use the GPU.

## Versions

| Part                         | Version                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------- |
| Transcriber base image       | `nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04` (CUDA 12.8, cuDNN 9, Python 3.12) |
| faster-whisper / CTranslate2 | 1.2.1 / 4.8.2 (Blackwell, sm_120, runs on the RTX 5080)                          |
| Extras (optional)            | torch 2.11.0 (cu128), transformers 4.57.6                                        |
| Pipeline base image          | `python:3.12-slim`                                                               |

## What stays on the host

The Claude writing step (clean-up, translation, session notes from `timeline.md`) runs on the host in
Claude Desktop or Claude Code on the subscription. The containers do only the mechanical half: GPU
transcription and the deterministic merge. Nothing here calls a paid API.
