# Transcriber (GPU, Docker)

Turns one audio file per speaker into one JSON per speaker, in the exact shape
`tools/session-pipeline` reads (the VoiceBench output shape: `segments` and flat `words`). It runs in
a container on an NVIDIA CUDA 12.8 + cuDNN 9 base, so the host needs only Docker Desktop and a driver.
Normally you do not call it directly: `scripts/voice-stack.ps1 transcribe <session>` runs it and then
the pipeline (see `tools/voice-stack/README.md`).

## Input

A folder (searched recursively), a Craig `.zip`, or a single file. Audio extensions: wav, flac, ogg,
oga, opus, mp3, m4a, aac, wma. Webm and mp4 are skipped (camera video).

| Source          | File name                              | Speaker                               |
| --------------- | -------------------------------------- | ------------------------------------- |
| Craig           | `1-anna_0.flac`                        | `anna`                                |
| LiveKit         | `<identity>__<source>__<trackSid>.ogg` | `<identity>`                          |
| Benchmark style | `S3__anna.wav`                         | `anna` (output keeps `S3__anna.json`) |
| Other           | `anna.wav`                             | `anna`                                |

Two files for one speaker give `anna` and `anna-2` (check the order: each file's time starts at zero).
The folders `transcripts`, `timeline` and `out` inside the input folder are never read back.

## Output

`<out>/json/<speaker>.json` (default `<input folder>/transcripts`) and `<out>/run.json` (settings and
a summary). Each JSON has `engine`, `variant`, `slice`, `speaker`, `seconds`, `audio_s`, VRAM figures,
`segments` (`start end text avg_logprob no_speech_prob compression_ratio`) and `words`
(`start end word p`). The JSON also carries the `settings` used.

## Default profile (chosen by the 2026-09-30 benchmark)

Model `large-v3-turbo` (downloaded once into the `/cache` volume), language `da`, Silero VAD filter on,
`condition_on_previous_text` off, `no_speech_threshold` 0.85, `compression_ratio_threshold` 2.4, word
timestamps on, beam size 5, float16 on the GPU, and **hotwords from a names file, never
`initial_prompt`**. Every one of these can be changed on the command line (`--model`, `--language`,
`--no-vad`, `--condition-on-previous-text`, `--no-speech-threshold`, ...). The VAD is the Silero model
bundled with faster-whisper, the same one the benchmark used, so there is no separate `silero-vad`
package.

### When the GPU fails

An unattended run after a session should still finish. Before loading the model on the GPU, a
child process loads it and transcribes one second of silence (stopped after three minutes). When
that fails or hangs (another GPU job holds the memory, a driver hiccup, a missing CUDA library such
as `cublas64_12.dll`, which on one PC loaded fine and then failed or hung at the first inference),
the run tries `int8_float16` on the GPU (about half the memory), then `int8` on the CPU (much
slower, but it finishes). The failed attempts are listed under `load_failures` in each JSON's
`settings`. A `--compute-type` given on the command line is used as is, with no fallback.

### Names as hotwords

`--names FILE` (alias `--hotwords`) takes one name per line, **most important first** (commas,
`# comment` and `=== heading ===` lines also work). `scripts/voice-stack.ps1 names <session>` builds that
file from the Foundry world. faster-whisper treats hotwords as a prompt in front of every 30 s window;
the prompt holds at most 223 tokens (`max_length // 2 - 1` of Whisper's 448) and faster-whisper cuts the
rest off the end of the string without a warning. A long list is also more likely to be recited back
by the model. So the list is capped by tokens: `--hotwords-max-tokens` (default **200**, hard
ceiling 223). The names are kept in file order while they fit, counted with the model's own
tokenizer; a name that does not fit is dropped and shorter ones after it may still fit. The run prints
how many names fit and `run.json` records the counts (not the names). Typical proper names cost
about 4 tokens each with the comma, so 200 tokens is roughly 50 names. Put the names that Whisper gets
wrong most often first (player characters, then NPCs, then places).

`--prompt FILE` (the initial prompt) is still there, but the benchmark found it worse than hotwords
for names.

## Other models

`--model` takes a faster-whisper name, a Hugging Face id of a CTranslate2 model, or a folder.
hviske-v6 and saga-2-m are not Whisper: they need the image built with the extras
(`docker build --build-arg WITH_TRANSFORMERS=1 -t fvtt-transcriber:extras tools/transcriber`, adds
torch 2.11.0 cu128 and transformers) and a model folder (mounted into the container) or a Hugging
Face id. They run in chunk mode: Silero chunks, batched, with evenly spread pseudo word times
(`"pseudo_words": true` in the JSON). The hviske path follows the benchmark script. The saga-2-m path
is written from its model card and has not been run (gated model).

## Hugging Face token

Never baked into the image and never printed. The image sets `HF_TOKEN_PATH=/run/secrets/hf_token`;
the compose file bind-mounts the host token file there read-only. Public models need no token.

## Tests

The tests cover file discovery, speaker naming, the vocabulary parser, the default profile and the hotwords budget and need no GPU:

```powershell
docker run --rm -e PYTHONDONTWRITEBYTECODE=1 -v "${PWD}/tools/transcriber:/src:ro" --entrypoint sh fvtt-transcriber -c "pip install -q pytest && cd /src && python -m pytest -p no:cacheprovider"
```
