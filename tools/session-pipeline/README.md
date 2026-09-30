# Session pipeline (machine half)

The model-independent first part of the automatic session pipeline: it takes one transcription JSON
per speaker (as faster-whisper writes it with word timestamps) and turns them into one
speaker-labelled, cleaned timeline. Pure Python, no dependencies, deterministic, no AI tokens.

```
per-speaker JSON -> filters -> merge (interleave) -> echo filter -> name fixing -> timeline files
```

This is a standalone Python package, not an npm workspace. Transcription itself (the model, Silero
chunks, hotwords) and the Claude steps that come after (clean-up, translation, notes) live elsewhere.

## Setup

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m pytest
```

## Input

One JSON file per speaker. Two shapes are accepted:

- flat, as the benchmark scripts write it: `{"segments": [...], "words": [...]}`; words are attached to
  segments by time. A word carries `start`, `end`, `word`, and `p` or `probability`.
- nested: each segment has its own `"words"` list.

A segment has `start`, `end`, `text` and optionally `no_speech_prob`, `avg_logprob`,
`compression_ratio`. A segment without words gets synthetic words spread over its time span.
The track id comes from the file name (`S1__anna.json` and `anna.json` both give `anna`).

Typed model and adapter: `session_pipeline/model.py`.

## Run

```powershell
python -m session_pipeline merge <folder> --out <dir> --speakers speakers.json --vocab vocab.txt
```

| Option | Meaning |
| ------ | ------- |
| `--speakers` | JSON, track id -> `{"player": "...", "character": "..."}` |
| `--vocab` | terms separated by commas or lines (`# comment` and `=== heading ===` lines are skipped); used by the recitation filter and, unless `--names` is given, by the near-name suggester |
| `--names` | known names only (later: from the Foundry world) |
| `--rules` | JSON, correct spelling -> list of wrong spellings |
| `--ordinary-words` | file of ordinary words the suggester must ignore |
| `--ordinary-min-count` | words at least this frequent in the session also count as ordinary (default 3, 0 disables) |
| `--levels` | JSON, track id -> RMS level in dB; turns on dropping of echo lines |
| `--glob` | which files to read (default `*.json`) |

Output in `--out`:

- `timeline.jsonl`: `start`, `end`, `speaker` (track id), `player`, `character`, `text`, `words`
  (and `echo_suspect` when flagged). `text` has the name rules applied, `words` stay as heard.
- `timeline.md`: `[hh:mm:ss] Character [Player]: text`
- `low_confidence.jsonl`: words under probability 0.6 with time and speaker
- `fixes.json`: applied name rules and name suggestions (suggestions are never applied)
- `dropped.jsonl`: everything a filter removed, with the reason

## What each stage does

- `filters.py`: drops segments with `no_speech_prob > 0.85` or `compression_ratio > 2.4`, stock
  caption phrases (Danish and English), recited vocabulary lists and a name repeated 4+ times;
  collapses repetition loops (same sentence 3+ times, word n-grams 4+ times, `hahahaha` inside one
  token) and 3+ identical segments in a row; drops segments under 200 ms; lists low-confidence words.
- `merge.py`: all words of all speakers sorted by `(start, speaker, end)`, one open clause buffer per
  speaker, a speaker's line reaches the output only when its clause closes (terminal punctuation or a
  word gap over 0.8 s), buffers open longer than 9 s are closed at their largest gap, a line that
  starts over 5 s before the previous one is re-split at gaps, neighbouring lines of one speaker are
  merged unless 4 s apart (and never beyond 30 s).
- `echo.py`: a line whose text matches (similarity 0.85) a line on another track that started up to
  1.5 s earlier is an echo. With levels it is dropped when its track is 6 dB quieter; without levels it
  is kept and flagged `echo_suspect`.
- `names.py`: whole-word, case-insensitive rules that keep the case style (so `Dag` never changes
  `Dagstorp`), plus a difflib near-name suggester (ratio 0.85) that only suggests, only for words that
  are not ordinary words.
- `timeline.py`, `cli.py`: the glue and the files.

Every threshold is a field of `FilterConfig`, `MergeConfig` or `EchoConfig`.

### Tuning notes

- `FilterConfig.min_word_s` is off by default (0). On real Danish tracks more than half of all words
  are shorter than 200 ms ("og", "i", "at"), so a per-word 200 ms rule would wreck the text. The 200 ms
  rule applies to whole segments.
- The near-name suggester is only as good as its name list. Feed it proper names (characters, NPCs,
  places), not game terms: English game terms produce false hits against Danish words.

## Data rules

The repository is public. Never commit audio, real transcripts, real speaker maps or campaign text.
`.gitignore` blocks audio files and the local folders `local/`, `data/`, `out/`, `scratch/`. The tests
use small synthetic fixtures only.

## Credits

The interleave in `merge.py` is adapted from the ideas of TASMAS (`assemble.py`),
https://github.com/KaddaOK/TASMAS, used under the MIT License:

```
MIT License

Copyright (c) 2024 Kadda OK

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Other projects (dnd-transcriber, audio-transcriber, squire, dnd_transcribe) are unlicensed and were
only read for ideas; no code was taken from them.
