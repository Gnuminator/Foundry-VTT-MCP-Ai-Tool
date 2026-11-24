# Names check cards (any session folder)

`node scripts/names-check.mjs <session folder or name>` builds the cards for a names-check artifact
page from a recorded session. It reads `timeline/timeline.jsonl` (what the transcriber heard) and
`notes/transcript.en.md` (what the cleaner made of it). It needs ffmpeg for the clips (`--no-clips`
skips them). Output goes to `<session>/notes/names-check/`.

| Output                | What it holds                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entries/name-N.json` | One card: the word, other spellings, up to 3 raw lines, the guess, a note                                                                             |
| `clips/*.mp4`         | About 6 s either side of the hit (`--lead`), cut from that speaker's own `N-speaker.ogg` track, AAC in mp4 because artifact assets reject mp3 and ogg |
| `sweep.json`          | `outside`: names beyond the candidate list. `duplicates`: card pairs that may be one name                                                             |
| `page.html`           | The artifact page from `scripts/names-check-page.html` (title and suggestions filled in)                                                              |

## Where candidates come from

The page "Names and facts to check" (the uncertain words and their variants, with the pipeline's
suggestion), the NPC names in `notes/notes.json`, and a `--candidates file.json`
(`[{ "word", "also": [], "guess": {"type":"spelling","value","from"}, "note" }]`) for anything else.

## Matching rules

- The hit is a whole word, one of the listed spellings, with inflected forms (`s`, `e`, `en`,
  `ene`, `er`, `et`; only `s` for words of 4 letters or fewer) and possessives (`'s`).
- Up to 3 raw lines are shown, spread over the session (first, middle, last).
- The cleaner's line is the one with the same line id (`^u000123`) and the same player. If the ids
  disagree it takes the latest line by the same player within 40 s before the hit. A line by another
  speaker is never shown.
- The guess button reads "Cleaner's spelling" when the cleaner's lines hold a close spelling that
  the transcriber did not write, "Claude's guess" when it came from the pipeline's suggestion.
- Notes say only what the transcript shows (how often, in which spellings), never who an NPC is.

## Sweep

`sweep.json` lists capitalised words in the middle of cleaned sentences, `fixes.json` corrections and
low-confidence capitalised raw words that are not in `names.txt` and not on a card, with counts. It
also pairs cards whose spellings are close (Ken and Kenkun, Raffne and Raphne). Look through both
lists before publishing: add a `--candidates` entry for any real name, and merge the duplicates.

## Publishing

Clips hold the friends' voices. The artifact stays private, the clips are never committed, and
nothing here posts anywhere. Upload `clips/` as artifact assets (the page accepts only `/_blob/` or
`https://` audio sources), set `audio` on each context line from the uploaded url, and write the
cards as the `entries` collection of the page's db. Tests: `node --test scripts/names-check.test.mjs`.
