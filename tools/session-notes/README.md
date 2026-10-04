# Session notes writer

The Claude half of the session pipeline: it turns a session's merged timeline into notes in
Danish and English (D-072 layers L1 to L3). It runs Claude through the Claude Code CLI on the
subscription (`claude -p`, D-066); no API key, nothing paid unless the subscription itself.

```text
recording -> transcriber -> session-pipeline -> session-notes (this tool)
 (Discord)    (GPU, local)   (merge, names)      (Claude, subscription)
```

## Use

Needs Python 3.12+ (standard library only) and Claude Code installed and signed in on this PC.

```bash
cd tools/session-notes
python -m session_notes scenes <session>     # show the scene split, no Claude call
python -m session_notes run <session>        # write the notes
```

`<session>` is a session folder, or its name under `FVTT_SESSIONS_DIR` (default
`Documents\FoundrySessions`). The folder needs `timeline/timeline.jsonl` from
`voice-stack.ps1 transcribe`; a `names.txt` next to it (the same list the transcriber used for
hotwords) helps Claude spell names right.

| Option             | Default  | Meaning                                                              |
| ------------------ | -------- | -------------------------------------------------------------------- |
| `--scene-model`    | `sonnet` | model for the per-scene calls                                        |
| `--session-model`  | `sonnet` | model for the summary and the player recap                           |
| `--scene-effort`   | `medium` | reasoning effort for the scene calls (low, medium, high, xhigh, max) |
| `--session-effort` | `medium` | reasoning effort for the summary and the recap                       |
| `--workers`        | `3`      | scenes written at the same time                                      |
| `--scene-gap`      | `90`     | seconds of silence that start a new scene                            |
| `--only-scene N`   |          | process one scene (for trying prompt changes)                        |

Exit codes: 0 done, 1 error, 75 paused by a usage limit. After a pause, run the same command
again later; finished scenes are kept in `notes/.work/` and are not redone.

## Automatic runs

`auto.ps1` does one pass over the sessions folder: it transcribes finished Discord recordings
(`raw\session.json` present, audio, no timeline yet; names from Foundry when the bridge answers),
writes notes where they are missing, publishes finished notes to the bridge (below), and runs
`cleanup --yes`. It does nothing when nothing is due,
never runs twice at once (a lock file), and logs to `<sessions>\auto.log`. Try it with
`pwsh tools/session-notes/auto.ps1 -DryRun`. With the recorder on the Orange Pi (D-068), set `FVTT_PI_HOST`
(normally `foundry-pi`): the pass first runs `pull.ps1`, which copies finished recordings from the
Pi over SSH, checks every file's SHA-256 and marks them pulled there (the Pi deletes them 7 days
later; see the bot's README). Set `MCP_CONTROL_HOST` to the Pi's Tailscale name so `publish`
reaches the bridge there. A scheduled task in the Claude desktop app runs it
every hour while the PC is on, so the notes are ready the morning after a session with no clicks.

## What it writes

In `<session>/notes/`, for `da` and `en` each:

| File                     | Layer | What                                                                                                                                              |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transcript.<lang>.md`   | L1    | cleaned transcript by scene; each line has a block anchor `^u000123`; out-of-character talk in italics                                            |
| `scenes.<lang>.md`       | L2    | per scene: summary, events, decisions, NPCs, loot, open threads, dice, quotes, and a "GM only" section; every entry links to its transcript lines |
| `summary.<lang>.md`      | L3    | session summary and "what changed", for the GM                                                                                                    |
| `recap.player.<lang>.md` | L3    | the players' "previously on" recap, marked as a draft until the GM approves it                                                                    |

Plus `notes.json` (everything, for later steps) and `audit.jsonl` (calls, checks, fixes, pauses).

## Into Foundry (D-087)

```bash
python -m session_notes publish <session>                # the live bridge (port 31414)
python -m session_notes publish <session> --port 31514   # the test bridge
```

`publish` builds three pages from `notes.json` as plain HTML: **Recap**, **GM summary** and
**Scenes**, each with Danish first and English under an "English" heading (the transcript and the
links into it stay on the PC). It stages them once on the bridge (control method `session_notes`;
`FOUNDRY_AI_CONTROL_PORT` sets the port). The bridge keeps them in its vault and, with the switch
"AI Tool: Session notes (writes)" on, puts them into a GM-only journal in the folder "Session
notes" by itself as soon as a GM's Foundry client is connected with writes on, as a change with
Undo in Recent Changes. The Recap waits in the reveal queue for the GM. While Foundry is closed the
bridge needs to know the world: set `FVTT_WORLD` (else the next pass stages it). Each later run
only asks for the status, and once the GM revealed the Recap or pressed "Approve without revealing"
it writes `notes/approved.json` (below). Exit code 3 means "not now, try again later" (the bridge
is not running, or Foundry is closed and no world is set); `--restage` sends the notes again while
they are still only staged.

## Approval and audio retention (D-072)

```bash
python -m session_notes approve <session>   # the GM has read the notes and the recap
python -m session_notes cleanup             # list sessions whose audio is due for deletion
python -m session_notes cleanup --yes       # delete it
```

`approve` writes `notes/approved.json`. `cleanup` looks through the sessions folder and, for every
session approved more than 14 days ago (`--days` to change), deletes the audio only: `.ogg`,
`.flac`, `.wav` and the other audio types, the recorder's `raw/*.rec` packet files and Craig
zips. Transcripts, the timeline, the notes and the recorder's event log stay. The deleted files are
listed in `notes/audio-deleted.json`. Without `--yes` nothing is deleted. The scheduled task runs
`cleanup --yes` once a day. `publish` writes the same approval marker once the GM revealed or
approved the Recap in Foundry.

## Speed and cost

Measured on a 5-minute slice of real play (5 speakers, 86 timeline lines, one scene), Sonnet at
the default efforts: 3 minutes, about 65,000 input and 23,500 output tokens for the scene and the
summary together. A 4-hour session is about 25 scenes; with 3 workers expect about half an hour.
It all counts against the subscription's usage limits, which is why a limit pauses the run
instead of failing it.

## How it keeps Claude honest

- The timeline is split into scenes before any call: a new scene after 90 s of silence, long
  scenes cut at their largest pause (at most 15 minutes or 160 lines), short ones merged.
- One `claude -p --json-schema` call per scene with no tools and a short system prompt of our own.
- Every answer is checked: each input line must come back exactly once, in order. The cleaned
  text is a correction, not a rewrite: a line that drifts too far from what was said (word-level
  similarity under 0.4, lines of 5+ words) goes back to the raw text. Citations of unknown lines
  are dropped.
- A failed check is retried once; then the scene is split in two and each half tried once; a half
  that still fails keeps its raw text and is marked in the notes.
- The player recap is told to leave out everything in the scene notes' "GM only" lists. It is still
  only a draft: the GM reads it as a GM-only journal page and reveals it through the handout
  reveal flow before any player sees it.

## Tests

```bash
python -m pytest tools/session-notes      # with pytest installed; uses a fake Claude, no calls
```
