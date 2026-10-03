# Narration

The voiceover for the GM videos and feature clips (D-081): a script in Danish or English in, a
voiced WAV with captions out. Everything runs on the PC's GPU with local voices; no paid service,
no recorded lines.

| Language | Voice | Model | Notes |
| -------- | ----- | ----- | ----- |
| Danish | `mic` (default), `nic` | CoRal Roest v3 Chatterbox 500M (OpenRAIL) | cloned from the model card's own sample clips |
| English | `turbo` (default) | Chatterbox Turbo (MIT) | played at 0.92 speed; the listening test found it a little fast |

Both were the winners of the blind listening test on 2026-09-30. Both models add Resemble's
inaudible Perth watermark. `voice: ref:C:\path\clip.wav` clones any 5 to 15 second clip instead
(for a later clone of your own voice, read the model's terms first).

## Use

```powershell
pwsh tools/narration/narrate.ps1 list tools/narration/examples/welcome.da.md   # numbered sentences, no GPU
pwsh tools/narration/narrate.ps1 make tools/narration/examples/welcome.da.md   # voice it
pwsh tools/narration/narrate.ps1 retake tools/narration/examples/welcome.da.md 4 6
pwsh tools/narration/narrate.ps1 retake tools/narration/examples/welcome.da.md 4:0   # back to take 0
pwsh tools/narration/narrate.ps1 voices
```

`make` takes several scripts at once. Options: `--voice`, `--speed` (0.5 to 2.0), `--out` (default
`Documents\FoundryNarration`), `--retakes N` (automatic new takes per failing sentence, default 2),
`--no-check`.

A minute of narration takes about a minute the first time (plus about 30 seconds to load a model).
After that only new or changed sentences are voiced again.

## Script format

Markdown, one file per video and language (`intro.da.md`, `intro.en.md`):

```markdown
---
lang: da            # or from the file name: intro.da.md
voice: mic          # optional
speed: 1.0          # optional
sentence_gap: 0.25  # optional; also paragraph_gap, heading_gap, lead_in, tail (seconds)
---
# Before the session

First paragraph. Each sentence is voiced on its own.
Lines of one paragraph belong together.

[pause 1.5]
Open {Foundry|Faundri} now.
```

- A blank line is a paragraph break (a longer pause). A `#` heading is a chapter: a longer pause,
  and a line in `<name>.chapters.txt` in YouTube's format.
- `[pause 1.5]` adds 1.5 seconds of silence at that spot.
- `{shown|spoken}` shows one thing in the captions and says another.
- List items are paragraphs; links, bold and italics are read as plain text; `<!-- comments -->`
  are skipped.
- Danish scripts keep the English game and Foundry terms the table uses (token, hit points,
  attack, saving throw, disposition, Recent Changes); never translate them into pure Danish
  ("redningskast", "holdning"). Where the Danish voice says one badly, fix it in the
  pronunciation list, not in the script.
- Keep sentences under about 250 characters; the voices do worse on long ones (`list` warns).

## Pronunciation list

`lexicon/da.txt` and `lexicon/en.txt` hold `term = what to say` lines, for words the voices
get wrong (`dnd5e = D og D fem e`). A `lexicon.<lang>.txt` next to a script adds or overrides
entries for that folder. Only the spoken form changes; the captions keep the script's spelling.
A term joined to the next word by a hyphen gets a space there in the spoken form
("dnd5e-systemet" is read as "di-end-di fem-e systemet"), because a spelled-out term glued to a
word made the Danish voice slur both.

The Danish list was rated by ear (2026-10-01 and 10-03): "di-end-di" for D&D and "hitt pojnts"
for hit points; "saving throw" works best written as is.
`list` shows the spoken form of every sentence that differs.

## The listening check

Every new clip is transcribed back with Whisper (the project's `fvtt-transcriber` Docker image,
the same one the session pipeline uses) and compared with the script. A clip is taken again with
another seed when:

- the heard text differs by more than 20 % of its characters (spaces ignored, so "scene
  kontrollerne" and "scenekontrollerne" count as the same), or
- its length does not fit its text (slower than 6 or faster than 28 characters a second).

After two failed retakes the best take is kept and the sentence is listed at the end ("Listen to
sentence N"), with what Whisper heard. The check needs Docker Desktop running and the image built
(`pwsh scripts/voice-stack.ps1 up transcribe`); without it the run says why and skips the check.
Whisper also mishears now and then, so a passed check is not a promise: listen to the result.

## What it writes

In `<out>\<script name>\`:

| File | What |
| ---- | ---- |
| `<name>.wav` | the narration: 48 kHz, 24-bit mono, about -16 LUFS, limiter at -1.5 dBFS (true peak about -1.2) |
| `<name>.srt`, `<name>.vtt` | captions from the real sentence timings (at most two lines of 42 characters) |
| `<name>.chapters.txt` | chapter list for a YouTube description (only when the script has headings) |
| `<name>.timing.json` | every sentence's start and end, shown and spoken text, take, seed and check result; the video editing step reads this |
| `takes.json`, `.cache\` | which take each sentence uses, and the voiced clips |

A sentence's clip is cached under its voice, settings and spoken text, so the same sentence is
never voiced twice. Clips of sentences that left the script are deleted on the next run. Audio
never goes into the repo.

## Setup

`narrate.ps1` reads `%APPDATA%\foundry-ai-tool\narration.env`:

```
NARRATION_PYTHON=C:\path\to\venv\Scripts\python.exe
HF_HOME=C:\path\to\hf-cache
```

The voice environment is Python 3.12 with a CUDA 12.8 PyTorch (the RTX 5080 needs it) and
`chatterbox-tts` 0.1.7 installed without its dependencies, because its pins ask for torch 2.6,
which has no Blackwell support:

```powershell
python -m venv C:\path\to\venv
C:\path\to\venv\Scripts\pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
C:\path\to\venv\Scripts\pip install --no-deps chatterbox-tts==0.1.7
C:\path\to\venv\Scripts\pip install "numpy<2" librosa==0.11.0 s3tokenizer transformers==5.2.0 `
  diffusers==0.29.0 "resemble-perth>=1.0.0" conformer==0.3.2 safetensors==0.5.3 spacy-pkuseg `
  pykakasi==2.3.0 pyloudnorm omegaconf
```

That is chatterbox-tts 0.1.7's own list without torch (kept at the cu128 build) and without
gradio (only its demo app uses it).

The models (about 5.4 GB for Roest, 3 GB for Turbo) download into `HF_HOME` on first use; no
Hugging Face login is needed. ffmpeg must be on PATH (`winget install Gyan.FFmpeg`). On the
build PC the environment from the voice listening test is used
(`Documents\VoiceTest\venvs\chatterbox`); the recipe above is how that one was made.

## Tests

Plain Python with numpy and pytest, plus ffmpeg on PATH; no GPU and no models (a fake voice and a
fake Whisper stand in):

```powershell
cd tools/narration
python -m pytest
```
